import { useCallback } from "react";
import { produce } from "immer";
import { toast } from "sonner";
import { setRepeatStart, setRepeatEnd } from "@viritura/core";
import type { Score, ScorePatch } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";
import { useSelectionStore, type SelectionState } from "../store/selectionStore";
import type { RadialMenuCategory } from "../radialMenu";
import {
  resolveClef,
  resolveBarline,
  parseAddMeasures,
  resolveTimeSignature,
  parseTimeSignatureInputWithError,
  resolveKeySignature,
  resolveOrnament,
  resolveBreathFermata,
  resolveTuplet,
  parseTupletRatio,
  parseDynamicExpression,
  parseMixedExpression,
  isMixedExpression,
  resolveFingering,
  resolveRepeat,
  resolveArticulation,
} from "../radialMenu";
import {
  addDynamic,
  addDynamicExpression,
  addMixedExpression,
  applyOrnament,
  applyBreathFermata,
} from "../radialMenu/radialMenuActions";
import { resolveInsertMeasureIndex, timeSignatureMeasureIndexFromSelection } from "../commands/signatureCommands";
import { createPickupBar, parsePickupDuration } from "../commands/pickupBar";
import { openPickupDurationPrompt } from "../store/modalFlowStore";
import { toggleMeasureRepeatForSelection } from "../commands/measureRepeatCommands";
import {
  applyArticulationToSelection,
  applyTremoloToSelection,
  applyFingeringToSelection,
  planArticulationForSelection,
  planTremoloForSelection,
  planFingeringForSelection,
} from "../radialMenu/applyToSelection";
import type { Barline, Clef, KeySignature, TimeSignature, RepeatStart, RepeatEnd } from "@viritura/core";

export interface RadialMenuState {
  category: RadialMenuCategory;
  position: { x: number; y: number };
  selection?: SelectionState;
}

export interface RadialMenuHandlersDeps {
  store: DocumentStore;
  radialMenu: RadialMenuState | null;
  selectedScoreIndex: number;
  setRadialMenu: (m: RadialMenuState | null) => void;
  updateScore: (s: Score) => void;
  commitPatches: (patches: readonly ScorePatch[]) => void;
  applyTupletFromRadial: (num: number, outer?: number) => void;
  addMeasures: (count: number, atIndex?: number) => void;
  getSelectedMeasureIndex: () => number | null;
  handleSetClef: (value: Clef) => void;
  handleSetBarline: (value: Barline) => void;
  handleSetTimeSignature: (value: TimeSignature) => void;
  handleSetKeySignature: (value: KeySignature) => void;
  handleSetRepeatStart: (value: RepeatStart | null) => void;
  handleSetRepeatEnd: (value: RepeatEnd | null) => void;
}

export interface RadialMenuHandlers {
  handleRadialMenuSelect: (id: string) => void;
  handleRadialMenuExpression: (expression: string) => void;
}

export function useRadialMenuHandlers(deps: RadialMenuHandlersDeps): RadialMenuHandlers {
  const {
    store,
    radialMenu,
    selectedScoreIndex,
    setRadialMenu,
    updateScore,
    commitPatches,
    applyTupletFromRadial,
    addMeasures,
    getSelectedMeasureIndex,
    handleSetClef,
    handleSetBarline,
    handleSetTimeSignature,
    handleSetKeySignature,
    handleSetRepeatStart,
    handleSetRepeatEnd,
  } = deps;

  const handleRadialMenuSelect = useCallback(
    async (id: string) => {
      const { score } = store.getState();
      if (!radialMenu || !score) return;
      const selection = radialMenu.selection ?? useSelectionStore.getState().selection;
      if (radialMenu.category === "barline" && id === "create-pickup") {
        await createPickupFromRadial(store, updateScore, setRadialMenu);
        setRadialMenu(null);
        return;
      }
      dispatchRadialSelect(radialMenu.category, id, {
        score,
        selection,
        selectedScoreIndex,
        updateScore,
        commitPatches,
        applyTupletFromRadial,
        getSelectedMeasureIndex,
        handleSetClef,
        handleSetBarline,
        handleSetTimeSignature,
        handleSetKeySignature,
        handleSetRepeatStart,
        handleSetRepeatEnd,
      });
      setRadialMenu(null);
    },
    [
      radialMenu,
      store,
      selectedScoreIndex,
      handleSetClef,
      handleSetBarline,
      handleSetTimeSignature,
      handleSetKeySignature,
      updateScore,
      commitPatches,
      applyTupletFromRadial,
      handleSetRepeatStart,
      handleSetRepeatEnd,
      getSelectedMeasureIndex,
      setRadialMenu,
    ],
  );

  const handleRadialMenuExpression = useCallback(
    (expression: string) => {
      const { score } = store.getState();
      if (!radialMenu || !score) return;
      const selection = radialMenu.selection ?? useSelectionStore.getState().selection;

      if (radialMenu.category === "tuplet") {
        const ratio = parseTupletRatio(expression);
        if (ratio && selection.kind !== "none") applyTupletFromRadial(ratio.num, ratio.outer);
        else toast.warning(ratio ? "Select notes before creating a tuplet" : "Enter a valid tuplet ratio");
        setRadialMenu(null);
        return;
      }

      if (radialMenu.category === "barline") {
        const count = parseAddMeasures(expression);
        if (count) {
          const at = resolveInsertMeasureIndex(selection.kind === "single" ? selection.elementId : null, score);
          addMeasures(count, at);
        } else toast.warning("Enter a measure count from 1 to 999, for example +4");
        setRadialMenu(null);
        return;
      }

      if (radialMenu.category === "time-signature") {
        applyTimeSignatureExpression(expression, selection, score, updateScore, handleSetTimeSignature);
        setRadialMenu(null);
        return;
      }

      const symbolicDynamicTokens =
        expression.includes("<") || expression.includes(">") ? parseDynamicExpression(expression) : null;
      if (symbolicDynamicTokens) {
        const newScore = addDynamicExpression(score, selection, symbolicDynamicTokens, selectedScoreIndex);
        if (newScore) updateScore(newScore);
        else toast.warning("Select a note or range before adding a dynamic");
        setRadialMenu(null);
        return;
      }

      if (isMixedExpression(expression)) {
        const mixedTokens = parseMixedExpression(expression);
        if (mixedTokens) {
          const newScore = addMixedExpression(score, selection, mixedTokens, selectedScoreIndex);
          if (newScore) updateScore(newScore);
          else toast.warning("Select a note or range before adding an expression");
          setRadialMenu(null);
          return;
        }
      }

      const tokens = parseDynamicExpression(expression);
      if (tokens) {
        const newScore = addDynamicExpression(score, selection, tokens, selectedScoreIndex);
        if (newScore) updateScore(newScore);
        else toast.warning("Select a note or range before adding a dynamic");
        setRadialMenu(null);
        return;
      }

      const textTokens = parseMixedExpression(expression);
      if (textTokens) {
        const newScore = addMixedExpression(score, selection, textTokens, selectedScoreIndex);
        if (newScore) updateScore(newScore);
        else toast.warning("Select a note or range before adding an expression");
      }
      setRadialMenu(null);
    },
    [
      radialMenu,
      store,
      selectedScoreIndex,
      updateScore,
      applyTupletFromRadial,
      addMeasures,
      handleSetTimeSignature,
      setRadialMenu,
    ],
  );

  return { handleRadialMenuSelect, handleRadialMenuExpression };
}

// ── Pure dispatch helpers (one per radial-menu category) ──

interface DispatchDeps {
  score: Score;
  selection: SelectionState;
  selectedScoreIndex: number;
  updateScore: (s: Score) => void;
  commitPatches: (patches: readonly ScorePatch[]) => void;
  applyTupletFromRadial: (num: number, outer?: number) => void;
  getSelectedMeasureIndex: () => number | null;
  handleSetClef: (value: Clef) => void;
  handleSetBarline: (value: Barline) => void;
  handleSetTimeSignature: (value: TimeSignature) => void;
  handleSetKeySignature: (value: KeySignature) => void;
  handleSetRepeatStart: (value: RepeatStart | null) => void;
  handleSetRepeatEnd: (value: RepeatEnd | null) => void;
}

async function createPickupFromRadial(
  store: DocumentStore,
  updateScore: (score: Score) => void,
  setRadialMenu: (menu: RadialMenuState | null) => void,
): Promise<void> {
  const score = store.getState().workingScore ?? store.getState().score;
  if (!score) return;
  if (score.global.measures[0]?.number === 0) {
    toast.warning("This score already begins with a pickup bar.");
    return;
  }
  const time = score.global.measures[0]?.time ?? { count: 4, unit: 4 };
  setRadialMenu(null);
  const entered = await openPickupDurationPrompt(time);
  const duration = entered ? parsePickupDuration(entered) : null;
  const latestScore = store.getState().workingScore ?? store.getState().score;
  if (!duration || !latestScore) return;
  const pickup = createPickupBar(latestScore, duration);
  if (pickup.score) updateScore(pickup.score);
  else toast.warning(pickup.error);
}

function applyTimeSignatureExpression(
  expression: string,
  selection: SelectionState,
  score: Score,
  updateScore: (score: Score) => void,
  setTimeSignature: (time: TimeSignature) => void,
): void {
  const result = parseTimeSignatureInputWithError(expression);
  if (!result.time) {
    toast.warning(result.error);
    return;
  }
  if (!result.pickupDuration) {
    setTimeSignature(result.time);
    return;
  }
  if ((timeSignatureMeasureIndexFromSelection(selection, score) ?? 0) !== 0) {
    toast.warning("A pickup duration can only be entered at the opening meter.");
    return;
  }
  const pickup = createPickupBar(score, result.pickupDuration, result.time);
  if (pickup.score) updateScore(pickup.score);
  else toast.warning(pickup.error);
}

function dispatchRadialSelect(category: RadialMenuCategory, id: string, deps: DispatchDeps): void {
  switch (category) {
    case "clef": {
      const c = resolveClef(id);
      if (c) deps.handleSetClef(c);
      break;
    }
    case "barline": {
      const b = resolveBarline(id);
      if (b) deps.handleSetBarline(b);
      break;
    }
    case "time-signature": {
      const t = resolveTimeSignature(id);
      if (t) deps.handleSetTimeSignature(t);
      break;
    }
    case "key-signature": {
      const k = resolveKeySignature(id);
      if (k) deps.handleSetKeySignature(k);
      break;
    }
    case "dynamic":
      applyUpdateOrWarn(deps, addDynamic(deps.score, deps.selection, id, deps.selectedScoreIndex));
      break;
    case "ornament":
      dispatchOrnament(id, deps);
      break;
    case "tuplet": {
      const t = resolveTuplet(id);
      if (t && deps.selection.kind !== "none") deps.applyTupletFromRadial(t.num);
      else if (t) warnSelectionRequired();
      break;
    }
    case "breath-fermata":
      dispatchBreathFermata(id, deps);
      break;
    case "fingering":
      dispatchFingering(id, deps);
      break;
    case "articulation":
      dispatchArticulation(id, deps);
      break;
    case "repeat":
      dispatchRepeat(id, deps);
      break;
  }
}

function applyUpdate(deps: DispatchDeps, newScore: Score | null | undefined): void {
  if (newScore && newScore !== deps.score) deps.updateScore(newScore);
}

function applyUpdateOrWarn(deps: DispatchDeps, newScore: Score | null | undefined): void {
  if (newScore && newScore !== deps.score) deps.updateScore(newScore);
  else warnSelectionRequired();
}

function warnSelectionRequired(): void {
  toast.warning("Select a compatible note, range, or measure first");
}

function dispatchOrnament(id: string, deps: DispatchDeps): void {
  const resolved = resolveOrnament(id);
  if (!resolved) return;
  applyUpdateOrWarn(deps, applyOrnament(deps.score, deps.selection, resolved, deps.selectedScoreIndex));
}

function dispatchBreathFermata(id: string, deps: DispatchDeps): void {
  const resolved = resolveBreathFermata(id);
  if (!resolved) return;
  applyUpdateOrWarn(deps, applyBreathFermata(deps.score, deps.selection, resolved, deps.selectedScoreIndex));
}

function dispatchFingering(id: string, deps: DispatchDeps): void {
  const finger = resolveFingering(id);
  if (finger === null) return;
  // Fast path: planner returns patches → commit. Falls back to slow path
  // when the planner returns null (e.g. selection unresolvable).
  const patches = planFingeringForSelection(deps.score, deps.selection, finger, deps.selectedScoreIndex);
  if (patches && patches.length > 0) {
    deps.commitPatches(patches);
    return;
  }
  const next = applyFingeringToSelection(deps.score, deps.selection, finger, deps.selectedScoreIndex);
  applyUpdateOrWarn(deps, next);
}

function dispatchArticulation(id: string, deps: DispatchDeps): void {
  const articulationType = resolveArticulation(id);
  if (!articulationType) return;
  const patches = planArticulationForSelection(deps.score, deps.selection, articulationType, deps.selectedScoreIndex);
  if (patches && patches.length > 0) {
    deps.commitPatches(patches);
    return;
  }
  const next = applyArticulationToSelection(deps.score, deps.selection, articulationType, deps.selectedScoreIndex);
  applyUpdateOrWarn(deps, next);
}

function dispatchRepeat(id: string, deps: DispatchDeps): void {
  const resolved = resolveRepeat(id);
  if (!resolved) return;
  const idx = deps.getSelectedMeasureIndex();
  switch (resolved.kind) {
    case "repeat-start":
      deps.handleSetRepeatStart({});
      break;
    case "repeat-end":
      deps.handleSetRepeatEnd({});
      break;
    case "repeat-both":
      if (idx !== null) {
        let next = setRepeatEnd(deps.score, Math.max(0, idx - 1), {});
        next = setRepeatStart(next, idx, {});
        deps.updateScore(next);
      } else warnSelectionRequired();
      break;
    case "measure-repeat": {
      const result = toggleMeasureRepeatForSelection(deps.score, deps.selection, resolved.number);
      if (result.error) toast.warning(result.error);
      else applyUpdate(deps, result.score);
      break;
    }
    case "segno":
    case "coda":
    case "fine":
      if (idx !== null) applyUpdate(deps, toggleGlobalMeasureMarker(deps.score, idx, resolved.kind));
      else warnSelectionRequired();
      break;
    case "tremolo": {
      const patches = planTremoloForSelection(deps.score, deps.selection, resolved.marks, deps.selectedScoreIndex);
      if (patches && patches.length > 0) {
        deps.commitPatches(patches);
      } else {
        applyUpdateOrWarn(
          deps,
          applyTremoloToSelection(deps.score, deps.selection, resolved.marks, deps.selectedScoreIndex),
        );
      }
      break;
    }
  }
}

function toggleGlobalMeasureMarker(score: Score, idx: number, prop: "segno" | "coda" | "fine"): Score {
  return produce(score, (draft) => {
    const gm = draft.global.measures[idx];
    if (!gm) return;
    const rec = gm as Record<string, unknown>;
    if (rec[prop]) delete rec[prop];
    else rec[prop] = { location: { fraction: [0, 1] } };
  });
}

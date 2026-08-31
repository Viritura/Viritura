import { useCallback } from "react";
import { toast } from "sonner";
import type { Score, LayoutContent, LayoutStaff, Part } from "@viritura/core";
import { resolvePartDisplayName } from "@viritura/core";
import { createPlayer, expandTemplate, getCatalogInstrument, ENSEMBLE_TEMPLATES } from "../score/InstrumentCatalog";
import {
  addInstrumentToScore,
  removeInstrumentFromScore,
  reorderInstrumentInScore,
  synchronizePartScoreDefinitions,
} from "../score/ScoreMutations";
import { addPartToScoreLayout, removePartFromScoreLayout } from "../score/ScoreMutations";
import { createSectionScore, setScoreLayoutMembership } from "../score/ScoreMutations";
import { openDrumKitEditorForPart } from "../store/drumKitTargetStore";
import { addSourceToStaffAt, removeSourceFromStaffAt, getStaffNodeAt, collectPartIds } from "./layoutHelpers";
import { buildCondensedLayoutContent, addOrReuseLayout } from "./condensedLayout";
import type { DocumentStore } from "../store/documentStore";

export interface ScoreListActionsDeps {
  store: DocumentStore;
  updateScore: (score: Score) => void;
  selectedScoreIndex: number;
  setSelectedScoreIndex: (i: number) => void;
  setExpandedCondensingStaves: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface ScoreListActions {
  handleAddScore: (type: "full" | "condensed" | "custom" | "part", partId?: string) => void;
  handleDeleteScore: (index: number) => void;
  handleRenameScore: (index: number, name: string) => void;
  handleDuplicateScore: (index: number) => void;
  handleReorderScores: (fromIndex: number, toIndex: number) => void;
  handleResetLayout: (index: number) => void;
  handleExpandCondensingStave: (pathKey: string) => void;
  handlePartUpdate: (partId: string, updates: Record<string, unknown>) => void;
  handleAddInstrument: (instrumentId: string, targetLayoutIds?: readonly string[]) => void;
  /**
   * Add every instrument of an ensemble template in a single score update.
   * Folding the additions keeps the whole ensemble one undo step and one
   * toast, rather than the N of calling `handleAddInstrument` in a loop.
   */
  handleAddEnsemble: (templateId: string) => void;
  handleRemoveInstrument: (partId: string) => void;
  /** Add an existing instrument's staff to a score's layout (part stays as-is). */
  handleAddInstrumentToScore: (scoreIndex: number, partId: string) => void;
  /** Remove an instrument's staff from a score's layout (part stays in the document). */
  handleRemoveInstrumentFromScore: (scoreIndex: number, partId: string) => void;
  /** Create a new section/conductor score containing exactly the given parts. */
  handleCreateSectionScore: (partIds: readonly string[], name?: string) => void;
  /** Set a score's instrument membership to exactly the given parts. */
  handleSetScoreMembership: (scoreIndex: number, partIds: readonly string[]) => void;
  handleReorderInstrument: (fromPartId: string, toPartId: string, placeAfter: boolean) => void;
  handleAddDoubling: (staffPath: number[], instrumentId: string) => void;
  handleRemoveDoubling: (staffPath: number[], sourceIndex: number) => void;
}

// eslint-disable-next-line max-lines-per-function -- aggregator hook: wraps ~10 score-list mutation callbacks (add/remove/rename score, add/remove instrument, add/remove doubling) in useCallback so consumers get stable identities. Each callback delegates to a computeXxx helper; the hook body is one-line wrappers and cannot decompose further without re-introducing the same length elsewhere.
export function useScoreListActions(deps: ScoreListActionsDeps): ScoreListActions {
  const { store, updateScore, selectedScoreIndex, setSelectedScoreIndex, setExpandedCondensingStaves } = deps;

  const handleAddScore = useCallback(
    (type: "full" | "condensed" | "custom" | "part", partId?: string) => {
      const { score } = store.getState();
      if (!score) return;
      const result = computeAddScore(score, type, partId);
      if (!result) return;
      updateScore(result.score);
      setSelectedScoreIndex(result.selectedIndex);
      toast.success("Score added");
    },
    [store, updateScore, setSelectedScoreIndex],
  );

  const handleDeleteScore = useCallback(
    (index: number) => {
      const { score } = store.getState();
      if (!score || index === 0) return;
      const scores = [...(score.scores ?? [])];
      scores.splice(index, 1);
      updateScore({ ...score, scores });
      if (selectedScoreIndex >= scores.length) setSelectedScoreIndex(scores.length - 1);
      else if (selectedScoreIndex === index) setSelectedScoreIndex(0);
      toast.success("Score deleted");
    },
    [store, updateScore, selectedScoreIndex, setSelectedScoreIndex],
  );

  const handleRenameScore = useCallback(
    (index: number, name: string) => {
      const { score } = store.getState();
      if (!score) return;
      const scores = [...(score.scores ?? [])];
      if (!scores[index]) return;
      scores[index] = { ...scores[index]!, name };
      updateScore({ ...score, scores });
    },
    [store, updateScore],
  );

  const handleDuplicateScore = useCallback(
    (index: number) => {
      const { score } = store.getState();
      if (!score) return;
      const scores = [...(score.scores ?? [])];
      const source = scores[index];
      if (!source) return;
      const layouts = [...(score.layouts ?? [])];
      const sourceLayout = layouts.find((l) => l.id === (source.layout ?? source.pages?.[0]?.systems?.[0]?.layout));
      let newLayoutId = source.layout;
      if (sourceLayout) {
        newLayoutId = `${sourceLayout.id}-copy-${Date.now()}`;
        layouts.push({ ...sourceLayout, id: newLayoutId });
      }
      scores.splice(index + 1, 0, { ...source, name: `${source.name ?? "Score"} (copy)`, layout: newLayoutId });
      updateScore({ ...score, layouts, scores });
      setSelectedScoreIndex(index + 1);
      toast.success("Score duplicated");
    },
    [store, updateScore, setSelectedScoreIndex],
  );

  const handleReorderScores = useCallback(
    (fromIndex: number, toIndex: number) => {
      const { score } = store.getState();
      if (!score) return;
      const scores = [...(score.scores ?? [])];
      if (fromIndex < 0 || fromIndex >= scores.length || toIndex < 0 || toIndex >= scores.length) return;
      const [moved] = scores.splice(fromIndex, 1);
      scores.splice(toIndex, 0, moved!);
      updateScore({ ...score, scores });
      if (selectedScoreIndex === fromIndex) {
        setSelectedScoreIndex(toIndex);
      } else if (fromIndex < selectedScoreIndex && toIndex >= selectedScoreIndex) {
        setSelectedScoreIndex(selectedScoreIndex - 1);
      } else if (fromIndex > selectedScoreIndex && toIndex <= selectedScoreIndex) {
        setSelectedScoreIndex(selectedScoreIndex + 1);
      }
    },
    [store, updateScore, selectedScoreIndex, setSelectedScoreIndex],
  );

  const handleResetLayout = useCallback(
    (index: number) => {
      const { score } = store.getState();
      if (!score) return;
      const scores = [...(score.scores ?? [])];
      const sd = scores[index];
      if (!sd) return;
      const layouts = [...(score.layouts ?? [])];
      const fullLayout = layouts[0];
      if (!fullLayout) return;

      const layoutId = sd.layout ?? sd.pages?.[0]?.systems?.[0]?.layout;
      const layoutIdx = layouts.findIndex((l) => l.id === layoutId);
      if (layoutIdx < 0) return;

      const hasCondensing = (content: LayoutContent[]): boolean =>
        content.some(
          (c) => (c.type === "staff" && c.sources.length > 1) || (c.type === "group" && hasCondensing(c.content)),
        );
      const isCondensed = hasCondensing(layouts[layoutIdx]!.content);

      const newContent = isCondensed
        ? buildCondensedLayoutContent(fullLayout.content, score.parts)
        : [...fullLayout.content];

      layouts[layoutIdx] = { ...layouts[layoutIdx]!, content: newContent };
      updateScore({ ...score, layouts });
      toast.success("Layout reset to default");
    },
    [store, updateScore],
  );

  const handleExpandCondensingStave = useCallback(
    (pathKey: string) => {
      setExpandedCondensingStaves((prev) => {
        const next = new Set(prev);
        if (next.has(pathKey)) next.delete(pathKey);
        else next.add(pathKey);
        return next;
      });
    },
    [setExpandedCondensingStaves],
  );

  const handlePartUpdate = useCallback(
    (partId: string, updates: Record<string, unknown>) => {
      const { score } = store.getState();
      if (!score) return;
      const partIndex = score.parts.findIndex((p) => p.id === partId);
      if (partIndex < 0) return;
      const newParts = [...score.parts];
      newParts[partIndex] = { ...newParts[partIndex]!, ...updates };
      updateScore({
        ...score,
        parts: newParts,
        scores: synchronizePartScoreDefinitions(newParts, score.scores ?? []),
      });
    },
    [store, updateScore],
  );

  const handleAddInstrument = useCallback(
    (instrumentId: string, targetLayoutIds?: readonly string[]) => {
      const { score } = store.getState();
      if (!score) return;
      const inst = getCatalogInstrument(instrumentId);
      const before = new Set(score.parts.map((p) => p.id));
      const updated = addInstrumentToScore(score, instrumentId, targetLayoutIds);
      updateScore(updated);
      toast.success(`Added ${inst?.name ?? instrumentId}`);
      // For a multi-piece drum kit, jump straight into its per-part mapping
      // editor so the user can customize sounds/noteheads right after adding.
      // Single-drum percussion (snare, bass drum) has a trivial 1-row kit, so
      // we don't interrupt for those.
      const newIndex = updated.parts.findIndex((p) => !before.has(p.id));
      const newPart = newIndex >= 0 ? updated.parts[newIndex] : undefined;
      if (newPart?.kit && Object.keys(newPart.kit).length > 1) {
        openDrumKitEditorForPart(newIndex);
      }
    },
    [store, updateScore],
  );

  // Ensemble templates were creation-only in the New Score wizard. Folding
  // `addInstrumentToScore` over the expanded template makes them usable at any
  // time (e.g. adding a string quartet to an existing score) while staying a
  // single undoable edit.
  const handleAddEnsemble = useCallback(
    (templateId: string) => {
      const { score } = store.getState();
      if (!score) return;
      const players = expandTemplate(templateId);
      if (players.length === 0) return;
      const updated = players.reduce<Score>((acc, player) => addInstrumentToScore(acc, player.instrumentId), score);
      if (updated === score) return;
      updateScore(updated);
      const name = ENSEMBLE_TEMPLATES.find((t) => t.id === templateId)?.name ?? "ensemble";
      toast.success(`Added ${name}`);
    },
    [store, updateScore],
  );

  const handleRemoveInstrument = useCallback(
    (partId: string) => {
      const { score } = store.getState();
      if (!score) return;
      if (score.parts.length <= 1) {
        toast.error("Cannot remove the last instrument");
        return;
      }
      const partName = score.parts.find((p) => p.id === partId)?.name ?? partId;
      const updated = removeInstrumentFromScore(score, partId);
      updateScore(updated);
      toast.success(`Removed ${partName}`);
    },
    [store, updateScore],
  );

  const handleAddInstrumentToScore = useCallback(
    (scoreIndex: number, partId: string) => {
      const { score } = store.getState();
      if (!score) return;
      const sd = score.scores?.[scoreIndex];
      const layoutId = sd?.layout ?? sd?.pages?.[0]?.systems?.[0]?.layout;
      if (!layoutId) return;
      const updated = addPartToScoreLayout(score, partId, layoutId);
      if (updated === score) return;
      updateScore(updated);
      const partName = score.parts.find((p) => p.id === partId)?.name ?? partId;
      toast.success(`Added ${partName} to ${sd?.name ?? "score"}`);
    },
    [store, updateScore],
  );

  const handleRemoveInstrumentFromScore = useCallback(
    (scoreIndex: number, partId: string) => {
      const { score } = store.getState();
      if (!score) return;
      const sd = score.scores?.[scoreIndex];
      const layoutId = sd?.layout ?? sd?.pages?.[0]?.systems?.[0]?.layout;
      if (!layoutId) return;
      const updated = removePartFromScoreLayout(score, partId, layoutId);
      if (updated === score) return;
      updateScore(updated);
      const partName = score.parts.find((p) => p.id === partId)?.name ?? partId;
      toast.success(`Removed ${partName} from ${sd?.name ?? "score"}`);
    },
    [store, updateScore],
  );

  const handleCreateSectionScore = useCallback(
    (partIds: readonly string[], name?: string) => {
      const { score } = store.getState();
      if (!score) return;
      const result = createSectionScore(score, partIds, name);
      if (!result) return;
      updateScore(result.score);
      setSelectedScoreIndex(result.selectedIndex);
      toast.success("Score added");
    },
    [store, updateScore, setSelectedScoreIndex],
  );

  const handleSetScoreMembership = useCallback(
    (scoreIndex: number, partIds: readonly string[]) => {
      const { score } = store.getState();
      if (!score) return;
      const sd = score.scores?.[scoreIndex];
      const layoutId = sd?.layout ?? sd?.pages?.[0]?.systems?.[0]?.layout;
      if (!layoutId) return;
      const updated = setScoreLayoutMembership(score, layoutId, partIds);
      if (updated === score) return;
      updateScore(updated);
      toast.success(`Updated ${sd?.name ?? "score"}`);
    },
    [store, updateScore],
  );

  const handleAddDoubling = useCallback(
    (staffPath: number[], instrumentId: string) => {
      const { score } = store.getState();
      if (!score) return;
      const result = computeAddDoubling(score, staffPath, instrumentId);
      if (!result) return;
      updateScore(result.score);
      toast.success(`Added ${result.displayName} as doubling`);
    },
    [store, updateScore],
  );

  const handleReorderInstrument = useCallback(
    (fromPartId: string, toPartId: string, placeAfter: boolean) => {
      const { score } = store.getState();
      if (!score) return;
      updateScore(reorderInstrumentInScore(score, fromPartId, toPartId, placeAfter));
    },
    [store, updateScore],
  );

  const handleRemoveDoubling = useCallback(
    (staffPath: number[], sourceIndex: number) => {
      const { score } = store.getState();
      if (!score) return;
      const staffNode = getStaffNodeAt(score.layouts ?? [], staffPath);
      if (!staffNode || staffNode.sources.length <= 1) return;
      const removedPartId = staffNode.sources[sourceIndex]?.part;
      const removedPartName = removedPartId
        ? (score.parts.find((p) => p.id === removedPartId)?.name ?? removedPartId)
        : "";
      const newLayouts = (score.layouts ?? []).map((layout) => ({
        ...layout,
        content: removeSourceFromStaffAt(layout.content, staffPath, sourceIndex),
      }));
      const allReferencedParts = new Set<string>();
      for (const layout of newLayouts) collectPartIds(layout.content, allReferencedParts);
      const newParts = score.parts.filter((p) => p.id && allReferencedParts.has(p.id));
      updateScore({ ...score, parts: newParts, layouts: newLayouts });
      toast.success(`Removed doubling ${removedPartName}`);
    },
    [store, updateScore],
  );

  return {
    handleAddScore,
    handleDeleteScore,
    handleRenameScore,
    handleDuplicateScore,
    handleReorderScores,
    handleResetLayout,
    handleExpandCondensingStave,
    handlePartUpdate,
    handleAddInstrument,
    handleAddEnsemble,
    handleRemoveInstrument,
    handleAddInstrumentToScore,
    handleRemoveInstrumentFromScore,
    handleCreateSectionScore,
    handleSetScoreMembership,
    handleReorderInstrument,
    handleAddDoubling,
    handleRemoveDoubling,
  };
}

// ─── Pure helpers (extracted so the hook fits the per-function line limit) ──

interface AddScoreResult {
  score: Score;
  selectedIndex: number;
}

function computeAddScore(
  score: Score,
  type: "full" | "condensed" | "custom" | "part",
  partId: string | undefined,
): AddScoreResult | null {
  const layouts = [...(score.layouts ?? [])];
  const scores = [...(score.scores ?? [])];
  if (type === "full") {
    const existing = layouts[0];
    if (!existing) return null;
    const id = `layout-full-${Date.now()}`;
    layouts.push({ ...existing, id });
    scores.push({ name: "Full Score (copy)", layout: id });
  } else if (type === "condensed") {
    const fullLayout = layouts.find((l) => l.id === (scores[0]?.layout ?? scores[0]?.pages?.[0]?.systems?.[0]?.layout));
    if (!fullLayout) return null;
    const condensedContent = buildCondensedLayoutContent(fullLayout.content, score.parts);
    const id = addOrReuseLayout(layouts, `layout-condensed-${Date.now()}`, condensedContent);
    scores.push({ name: "Condensed Score", layout: id });
  } else if (type === "custom") {
    const id = `layout-custom-${Date.now()}`;
    const fullLayout = layouts[0];
    layouts.push({ id, content: fullLayout ? [...fullLayout.content] : [] });
    scores.push({ name: "Custom Score", layout: id });
  } else if (type === "part" && partId) {
    const partScore = buildPartScoreEntry(score, partId);
    if (!partScore) return null;
    layouts.push(partScore.layout);
    scores.push(partScore.scoreDef);
  } else {
    return null;
  }
  return { score: { ...score, layouts, scores }, selectedIndex: scores.length - 1 };
}

function buildPartScoreEntry(
  score: Score,
  partId: string,
): { layout: { id: string; content: LayoutContent[] }; scoreDef: { name: string; layout: string } } | null {
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return null;
  const numStaves = part.staves ?? 1;
  const id = `layout-part-${partId}-${Date.now()}`;
  let content: LayoutContent[];
  if (numStaves > 1) {
    const staffNodes: LayoutStaff[] = [];
    for (let s = 1; s <= numStaves; s++) {
      staffNodes.push({ type: "staff", sources: [{ part: partId, staff: s, labelref: "name" }] });
    }
    content = [{ type: "group", symbol: "brace", content: staffNodes }];
  } else {
    content = [{ type: "staff", sources: [{ part: partId, labelref: "name" }] }];
  }
  const displayInfo = resolvePartDisplayName(partId, score.parts);
  return {
    layout: { id, content },
    scoreDef: { name: displayInfo?.displayName ?? part.name ?? partId, layout: id },
  };
}

interface AddDoublingResult {
  score: Score;
  displayName: string;
}

function computeAddDoubling(score: Score, staffPath: number[], instrumentId: string): AddDoublingResult | null {
  const newPlayer = createPlayer(instrumentId);
  const inst = getCatalogInstrument(instrumentId);
  const newPartId = `P${score.parts.length + 1}`;
  const staves = inst?.staves ?? 1;
  const measures = buildEmptyMeasures(score.global.measures.length, staves, inst);
  const newPart: Part = {
    id: newPartId,
    name: newPlayer.displayName,
    ...(newPlayer.displayShortName ? { shortName: newPlayer.displayShortName } : {}),
    measures,
    ...(staves > 1 ? { staves } : {}),
    ...(inst?.transposition
      ? {
          transposition: {
            interval: { halfSteps: inst.transposition.halfSteps, staffDistance: inst.transposition.staffDistance ?? 0 },
          },
        }
      : {}),
  };
  const newLayouts = (score.layouts ?? []).map((layout) => ({
    ...layout,
    content: addSourceToStaffAt(layout.content, staffPath, newPartId),
  }));
  return {
    score: { ...score, parts: [...score.parts, newPart], layouts: newLayouts },
    displayName: newPlayer.displayName,
  };
}

function buildEmptyMeasures(
  measureCount: number,
  staves: number,
  inst: ReturnType<typeof getCatalogInstrument>,
): Part["measures"] {
  const measures: Part["measures"] = [];
  for (let m = 0; m < measureCount; m++) {
    const mObj: Part["measures"][number] = { sequences: [] };
    if (m === 0 && inst) {
      const clefs = [];
      for (let s = 1; s <= staves; s++) {
        const clefDef = inst.clefs[s];
        if (clefDef)
          clefs.push({
            clef: { sign: clefDef.sign as "G" | "F" | "C", staffPosition: clefDef.staffPosition },
            ...(staves > 1 ? { staff: s } : {}),
          });
      }
      mObj.clefs = clefs;
    }
    const sequences = [];
    for (let s = 1; s <= staves; s++) {
      sequences.push({
        content: [],
        fullMeasure: { visualDuration: { base: "whole" as const } },
        ...(staves > 1 ? { staff: s } : {}),
      });
    }
    mObj.sequences = sequences;
    measures.push(mObj);
  }
  return measures;
}

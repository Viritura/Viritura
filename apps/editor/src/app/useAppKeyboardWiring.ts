import { useCallback, type RefObject, type MutableRefObject } from "react";
import type { Barline, Clef, LayoutSource, Score } from "@viritura/core";
import { type PanelImperativeHandle } from "react-resizable-panels";
import { useEditorKeyboard, type EditorKeyboardActions } from "../keyboard/useEditorKeyboard";
import { requestPanelToggle } from "../keyboard/panelToggle";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { DocumentStore } from "../store/documentStore";
import {
  useSelectionStore,
  type MeasureSelectionPoint,
  type RenderedStaffSources,
  type SelectionState,
} from "../store/selectionStore";
import type { RadialMenuCategory } from "../radialMenu";
import { sequenceContentBeats } from "../commands/noteCommands";
import {
  getEventAncestorId,
  resolveEventFromSubElement,
  resolveEventLocation,
  resolveFullMeasureRestLocation,
} from "../score/ElementPath";
import { resolveCondensedFullMeasureRestTargets } from "../score/condensedWriteback";
import { chordViewSources, anchoredChordSources } from "../score/chordSourceContext";
import { openDialog, toggleDialog } from "../store/dialogStore";
import type { RadialMenuState } from "../store/overlayStore";
import { buildNavigationIndex } from "../navigation";
import { useViewStateStore } from "../store/viewStateStore";
import { measureAttributeShortcuts } from "./measureAttributeShortcuts";

export interface TempoPopoverState {
  position: { x: number; y: number };
  initialValue: string;
  measureIndex: number;
  base: import("@viritura/core").NoteValueBase;
  dots: number;
  location?: { fraction: [number, number] };
}

export interface StaffTextPopoverState {
  position: { x: number; y: number };
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
  staff?: number;
  targets?: Array<{
    partIndex: number;
    measureIndex: number;
    sequenceIndex: number;
    eventIndex: number;
    tupletIndex?: number;
    graceContainerIndex?: number;
    staff?: number;
  }>;
}

export interface ChordSymbolPopoverState {
  position: { x: number; y: number };
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
  anchorStaff?: number;
  anchorElementId?: string;
  rhythmicPosition?: import("@viritura/core").RhythmicPosition;
}

export function resolveStaffTextTargets(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
): Omit<StaffTextPopoverState, "position"> | null {
  if (selection.kind !== "single") return null;
  const explicit =
    resolveEventFromSubElement(selection.elementId, score) ?? resolveEventLocation(selection.elementId, score);
  const location = explicit ?? resolveFullMeasureRestLocation(selection.elementId, score);
  if (!location) return null;
  const targetWithStaff = (target: typeof location) => {
    const part = score.parts[target.partIndex];
    const sequence = part?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
    const staff = (part?.staves ?? 1) > 1 ? (sequence?.staff ?? 1) : undefined;
    return { ...target, ...(staff !== undefined && { staff }) };
  };
  const targets = explicit
    ? undefined
    : resolveCondensedFullMeasureRestTargets(score, selectedScoreIndex, location).map(targetWithStaff);
  return { ...targetWithStaff(location), ...(targets && { targets }) };
}

function resolveMeasureChordTarget(
  score: Score,
  selection: Extract<SelectionState, { kind: "measure" }>,
  position: { x: number; y: number },
  selectedScoreIndex: number,
): ChordSymbolPopoverState | null {
  const measureIndex = selection.startMeasure;
  const source = resolveChordSymbolSource(score, selection, selectedScoreIndex, measureIndex);
  if (!source) return null;
  const { partIndex, staff } = source;
  const sequenceIndex = score.parts[partIndex]?.measures[measureIndex]?.sequences.findIndex(
    (sequence) => (sequence.staff ?? 1) === staff,
  );
  if (sequenceIndex === undefined || sequenceIndex < 0) return null;
  const anchor = buildNavigationIndex(score).entries.find(
    (entry) =>
      entry.partIndex === partIndex &&
      entry.measureIndex === measureIndex &&
      entry.sequenceIndex === sequenceIndex &&
      (entry.elementType === "event" || entry.elementType === "rest"),
  );
  return {
    position,
    partIndex,
    measureIndex,
    sequenceIndex,
    eventIndex: 0,
    anchorStaff: staff,
    rhythmicPosition: { fraction: [0, 1] },
    anchorElementId: anchor?.elementId,
  };
}

function harmonySources(score: Score, staves: LayoutSource[][]): LayoutSource[] {
  const validStaves = staves.map((staff) =>
    staff.filter((source) => score.parts.some((part) => part.id === source.part)),
  );
  const automaticPart = validStaves.flat()[0]?.part;
  const seenParts = new Set<string>();
  return validStaves.flatMap((staff) => {
    let harmony: LayoutSource | undefined;
    for (const source of staff) {
      const firstStaff = !seenParts.has(source.part);
      // Match the renderer: every source is consumed, even after this staff has a harmony owner.
      seenParts.add(source.part);
      const visibility = score.parts.find((part) => part.id === source.part)?.chordSymbolVisibility;
      const visible = visibility === "show" || (visibility !== "hide" && source.part === automaticPart);
      if (firstStaff && visible && !harmony) harmony = source;
    }
    return harmony ? [harmony] : [];
  });
}

function chordSourceAnchor(selection: SelectionState): MeasureSelectionPoint | undefined {
  if (selection.kind === "single") return selection.measureAnchor;
  if (selection.kind !== "measure") return undefined;
  return {
    partIndex: selection.startPartIndex,
    staffIndex: selection.startStaffIndex,
    localStaffIndex: selection.startLocalStaffIndex,
    measureIndex: selection.startMeasure,
  };
}

function renderedChordStaves(
  score: Score,
  staves: LayoutSource[][],
  rendered: RenderedStaffSources,
  measureIndex: number,
): LayoutSource[][] | undefined {
  const mapped = rendered?.filter((staff) => staff.measureIndex === measureIndex);
  if (!mapped?.length) return staves;
  const resolved = mapped
    .sort((left, right) => left.staffIndex - right.staffIndex)
    .map((staff) =>
      anchoredChordSources(
        score,
        {
          partIndex: score.parts.findIndex((part) => part.id === staff.partIds[0]),
          staffIndex: staff.staffIndex,
          measureIndex,
        },
        staves,
        rendered,
      ),
    );
  if (resolved.some((staff) => !staff)) return undefined;
  return resolved as LayoutSource[][];
}

export function resolveChordSymbolSource(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
  measureIndex: number,
  selectedPartIds: readonly string[] = useViewStateStore.getState().selectedPartIds,
): { partIndex: number; staff: number } | undefined {
  const staves = chordViewSources(score, selectedScoreIndex, measureIndex, selectedPartIds);
  const anchor = chordSourceAnchor(selection);
  if (anchor && anchor.measureIndex !== measureIndex) return undefined;
  const part = anchor && score.parts[anchor.partIndex];
  const state = useSelectionStore.getState();
  const rendered = state.renderedStaffSourcesGetter ? state.renderedStaffSourcesGetter() : state.renderedStaffSources;
  if (anchor && part && !rendered && !staves.some((staff) => staff.some((source) => source.part === part.id))) {
    return { partIndex: anchor.partIndex, staff: (anchor.localStaffIndex ?? 0) + 1 };
  }
  // Copy suffixes are not source coordinates. Use source bounds and authored
  // layout identities; never substitute a document-array index for a visual one.
  const candidates = anchor ? anchoredChordSources(score, anchor, staves, rendered) : undefined;
  if (anchor && !candidates) return undefined;
  let source: LayoutSource | undefined;
  if (selection.kind === "measure") {
    source = candidates?.find((candidate) => candidate.part === part?.id);
  } else {
    const harmonyStaves = renderedChordStaves(score, staves, rendered, measureIndex);
    if (!harmonyStaves) return undefined;
    const harmonies = harmonySources(score, harmonyStaves.length ? harmonyStaves : candidates ? [candidates] : []);
    source = harmonies.find(
      (candidate) =>
        !candidates ||
        candidates.includes(candidate) ||
        (!staves.length &&
          candidates.some((source) => source.part === candidate.part && source.staff === candidate.staff)),
    );
  }
  if (!source) return undefined;
  const partIndex = score.parts.findIndex((part) => part.id === source.part);
  return partIndex < 0 ? undefined : { partIndex, staff: source.staff ?? 1 };
}

function resolveExistingChordTarget(
  score: Score,
  selection: Extract<SelectionState, { kind: "single" }>,
  selectedScoreIndex: number,
  position: { x: number; y: number },
  chordMatch: RegExpMatchArray,
): ChordSymbolPopoverState | null {
  const measureIndex = Number(chordMatch[1]);
  const chord = score.global.measures[measureIndex]?.chordSymbols?.[Number(chordMatch[2])];
  if (!chord) return null;
  const source = resolveChordSymbolSource(score, selection, selectedScoreIndex, measureIndex);
  if (!source) return null;
  const { partIndex, staff } = source;
  const entries = buildNavigationIndex(score).entries.filter(
    (entry) =>
      entry.partIndex === partIndex &&
      entry.measureIndex === measureIndex &&
      (entry.elementType === "event" || entry.elementType === "rest") &&
      (score.parts[partIndex]?.measures[measureIndex]?.sequences[entry.sequenceIndex]?.staff ?? 1) === staff,
  );
  const beat = (chord.position.fraction[0] / chord.position.fraction[1]) * 4;
  const anchor = entries.findLast((entry) => entry.sortKey <= beat) ?? entries[0];
  if (!anchor) return null;
  return {
    position,
    partIndex,
    measureIndex,
    sequenceIndex: anchor.sequenceIndex,
    eventIndex: anchor.eventIndex,
    ...(anchor.tupletIndex !== undefined && { tupletIndex: anchor.tupletIndex }),
    anchorStaff: staff,
    anchorElementId: anchor.elementId,
    rhythmicPosition: chord.position,
  };
}

export function resolveChordSymbolTarget(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
  position: { x: number; y: number },
): ChordSymbolPopoverState | null {
  if (selection.kind === "measure") return resolveMeasureChordTarget(score, selection, position, selectedScoreIndex);
  if (selection.kind !== "single") return null;
  const chordMatch = selection.elementId.match(/^m(\d+)\/chord(\d+)(?:\/p(\d+)\/staff(\d+))?$/);
  if (chordMatch) return resolveExistingChordTarget(score, selection, selectedScoreIndex, position, chordMatch);
  const target = resolveStaffTextTargets(score, selection, selectedScoreIndex);
  if (!target) return null;
  return {
    position,
    partIndex: target.partIndex,
    measureIndex: target.measureIndex,
    sequenceIndex: target.sequenceIndex,
    eventIndex: target.eventIndex,
    ...(target.tupletIndex !== undefined && { tupletIndex: target.tupletIndex }),
    ...(target.graceContainerIndex !== undefined && { graceContainerIndex: target.graceContainerIndex }),
    ...(target.staff !== undefined && { anchorStaff: target.staff }),
    anchorElementId: getEventAncestorId(selection.elementId),
  };
}

export interface AppKeyboardWiringDeps {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  rightPanelRef: RefObject<PanelImperativeHandle | null>;
  mousePositionRef: MutableRefObject<{ x: number; y: number }>;
  store: DocumentStore;
  selection: SelectionState;
  currentZoom: number;
  selectedScoreIndex: number;
  onSwitchScore: (index: number) => void;
  getSelectedMeasureIndex: () => number | null;
  getSelectedPartIndex: () => number | null;
  handleOpenFile: () => void | Promise<void>;
  handleOpenProject: () => void | Promise<void>;
  handleSave: () => void | Promise<void>;
  handleSaveAs: () => void | Promise<void>;
  handleCopy: () => void | Promise<void>;
  handleCut: () => void | Promise<void>;
  handlePaste: () => void | Promise<void>;
  handlePasteMerge: () => void | Promise<void>;
  handleExplodeSelection: () => void;
  handleReduceSelection: () => void;
  handleSelectChordTopNote: () => void;
  handleSelectChordBottomNote: () => void;
  handleSetRepeatStart: (value: import("@viritura/core").RepeatStart | null) => void;
  handleSetRepeatEnd: (value: import("@viritura/core").RepeatEnd | null) => void;
  handleSetEnding: (value: import("@viritura/core").Ending | null) => void;
  handleSetBarline: (value: Barline) => void;
  handleSetClef: (value: Clef) => void;
  handleRepeat: () => void;
  setRadialMenu: (m: RadialMenuState | null) => void;
  setTempoPopover: (s: TempoPopoverState | null) => void;
  setStaffTextPopover: (s: StaffTextPopoverState | null) => void;
  setChordSymbolPopover: (s: ChordSymbolPopoverState | null) => void;
  setJumpBarOpen: (open: boolean) => void;
  onEnterLyrics: () => void;
  onOpenPublish: (() => void) | undefined;
  /** Create a new score (folder picker + Setup mode); replaces the old wizard dialog. */
  onNewScore: () => void;
}

export function adjacentScoreIndex(currentIndex: number, scoreCount: number, direction: -1 | 1): number | null {
  if (scoreCount < 2) return null;
  return (currentIndex + direction + scoreCount) % scoreCount;
}

export function togglePanels(
  leftPanelRef: RefObject<PanelImperativeHandle | null>,
  rightPanelRef: RefObject<PanelImperativeHandle | null>,
): void {
  const leftPanel = leftPanelRef.current;
  const rightPanel = rightPanelRef.current;
  const anyExpanded = (leftPanel && !leftPanel.isCollapsed()) || (rightPanel && !rightPanel.isCollapsed());
  if (anyExpanded) {
    leftPanel?.collapse();
    rightPanel?.collapse();
    return;
  }

  leftPanel?.expand();
}

/**
 * Wire global editor keyboard shortcuts. Mirrors the inline `useEditorKeyboard`
 * call previously in App.tsx; behaviour is unchanged.
 */
export function useAppKeyboardWiring(deps: AppKeyboardWiringDeps): EditorKeyboardActions {
  const {
    canvasRef,
    mousePositionRef,
    store,
    selection,
    currentZoom,
    selectedScoreIndex,
    onSwitchScore,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
    handleOpenFile,
    handleOpenProject,
    handleSave,
    handleSaveAs,
    handleCopy,
    handleCut,
    handlePaste,
    handlePasteMerge,
    handleExplodeSelection,
    handleReduceSelection,
    handleSelectChordTopNote,
    handleSelectChordBottomNote,
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
    handleSetBarline,
    handleSetClef,
    handleRepeat,
    setRadialMenu,
    setTempoPopover,
    setStaffTextPopover,
    setChordSymbolPopover,
    setJumpBarOpen,
    onEnterLyrics,
    onOpenPublish,
    onNewScore,
  } = deps;

  const onSetTempo = useCallback(() => {
    const { score } = store.getState();
    if (!score) return;
    const idx = getSelectedMeasureIndex() ?? 0;
    const existing = score.global.measures[idx]?.tempos?.[0];
    const current = existing?.bpm?.toString() ?? "";
    const base = existing?.value?.base ?? "quarter";
    const dots = existing?.value?.dots ?? 0;
    let location: { fraction: [number, number] } | undefined;
    if (selection.kind === "single") {
      const loc = resolveEventLocation(selection.elementId, score);
      if (loc && loc.measureIndex === idx) {
        const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
        if (seq) {
          let beatSum = 0;
          for (let i = 0; i < loc.eventIndex && i < seq.content.length; i++) {
            beatSum += sequenceContentBeats(seq.content[i]!);
          }
          const num = Math.round(beatSum * 256);
          const den = 1024;
          const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
          const d = g(num, den);
          location = { fraction: [num / d, den / d] };
        }
      }
    }
    setTempoPopover({
      position: { ...mousePositionRef.current },
      initialValue: current,
      measureIndex: idx,
      base,
      dots,
      location,
    });
  }, [store, getSelectedMeasureIndex, selection, mousePositionRef, setTempoPopover]);

  const onAddStaffText = useCallback(() => {
    const { score } = store.getState();
    if (!score) return;
    const target = resolveStaffTextTargets(score, selection, selectedScoreIndex);
    if (!target) return;
    setStaffTextPopover({
      position: { ...mousePositionRef.current },
      ...target,
    });
  }, [store, selection, mousePositionRef, selectedScoreIndex, setStaffTextPopover]);

  const onAddChordSymbol = useCallback(() => {
    const state = store.getState();
    const score = state.workingScore ?? state.score;
    if (!score) return;
    setChordSymbolPopover(
      resolveChordSymbolTarget(score, selection, selectedScoreIndex, { ...mousePositionRef.current }),
    );
  }, [store, selection, mousePositionRef, selectedScoreIndex, setChordSymbolPopover]);

  const onToggleCondensingPopover = useCallback(() => {
    toggleDialog("condensingPopover");
  }, []);

  const onOpenJumpBar = useCallback(() => setJumpBarOpen(true), [setJumpBarOpen]);

  const navigateScoreOrPart = useCallback(
    (direction: -1 | 1) => {
      const scoreCount = store.getState().score?.scores?.length ?? 0;
      const nextIndex = adjacentScoreIndex(selectedScoreIndex, scoreCount, direction);
      if (nextIndex !== null) onSwitchScore(nextIndex);
    },
    [store, selectedScoreIndex, onSwitchScore],
  );

  const measureShortcuts = measureAttributeShortcuts({
    getScore: () => store.getState().score ?? undefined,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
    handleSetBarline,
    handleSetClef,
  });

  return useEditorKeyboard({
    canvasRef,
    currentZoom,
    selectedScoreIndex,
    onNewScore: () => onNewScore(),
    onShowHelp: () => openDialog("help"),
    onOpenFile: () => void handleOpenProject(),
    onOpenMnxFile: () => void handleOpenFile(),
    onSave: () => {
      void handleSave();
    },
    onSaveAs: () => {
      void handleSaveAs();
    },
    onCopy: () => {
      void handleCopy();
    },
    onCut: () => {
      void handleCut();
    },
    onPaste: () => {
      void handlePaste();
    },
    onPasteMerge: () => {
      void handlePasteMerge();
    },
    onExplodeSelection: handleExplodeSelection,
    onReduceSelection: handleReduceSelection,
    onSelectChordTopNote: handleSelectChordTopNote,
    onSelectChordBottomNote: handleSelectChordBottomNote,
    onToggleRepeatStart: measureShortcuts.onToggleRepeatStart,
    onToggleRepeatEnd: measureShortcuts.onToggleRepeatEnd,
    onEditEnding: measureShortcuts.onEditEnding,
    onCycleBarline: measureShortcuts.onCycleBarline,
    onInsertClef: measureShortcuts.onInsertClef,
    onTogglePanels: requestPanelToggle,
    onOpenRadialMenu: (category: RadialMenuCategory) => {
      setRadialMenu({ category, position: { ...mousePositionRef.current }, selection });
    },
    onSetTempo,
    onAddStaffText,
    onEnterLyrics,
    onAddChordSymbol,
    onToggleCondensingPopover,
    onOpenJumpBar,
    onRepeat: handleRepeat,
    onPreviousScoreOrPart: () => navigateScoreOrPart(-1),
    onNextScoreOrPart: () => navigateScoreOrPart(1),
    onOpenPublish,
  });
}

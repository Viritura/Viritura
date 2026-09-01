import { useCallback, type RefObject, type MutableRefObject } from "react";
import type { Barline, Clef } from "@viritura/core";
import { type PanelImperativeHandle } from "react-resizable-panels";
import { useEditorKeyboard } from "../keyboard/useEditorKeyboard";
import { requestPanelToggle } from "../keyboard/panelToggle";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import type { RadialMenuCategory } from "../radialMenu";
import { sequenceContentBeats } from "../commands/noteCommands";
import { resolveEventLocation } from "../score/ElementPath";
import { openDialog, toggleDialog } from "../store/dialogStore";
import type { RadialMenuState } from "../store/overlayStore";

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
  handleSetRepeatStart: (value: import("@viritura/core").RepeatStart | null) => void;
  handleSetRepeatEnd: (value: import("@viritura/core").RepeatEnd | null) => void;
  handleSetEnding: (value: import("@viritura/core").Ending | null) => void;
  handleSetBarline: (value: Barline) => void;
  handleSetClef: (value: Clef) => void;
  handleRepeat: () => void;
  setRadialMenu: (m: RadialMenuState | null) => void;
  setTempoPopover: (s: TempoPopoverState | null) => void;
  setStaffTextPopover: (s: StaffTextPopoverState | null) => void;
  setJumpBarOpen: (open: boolean) => void;
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
export function useAppKeyboardWiring(deps: AppKeyboardWiringDeps): void {
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
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
    handleSetBarline,
    handleSetClef,
    handleRepeat,
    setRadialMenu,
    setTempoPopover,
    setStaffTextPopover,
    setJumpBarOpen,
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
    if (!score || selection.kind !== "single") return;
    const loc = resolveEventLocation(selection.elementId, score);
    if (!loc) return;
    setStaffTextPopover({
      position: { ...mousePositionRef.current },
      partIndex: loc.partIndex,
      measureIndex: loc.measureIndex,
      sequenceIndex: loc.sequenceIndex,
      eventIndex: loc.eventIndex,
    });
  }, [store, selection, mousePositionRef, setStaffTextPopover]);

  const onToggleCondensingPopover = useCallback(() => {
    toggleDialog("condensingPopover");
  }, []);

  const onOpenJumpBar = useCallback(() => {
    setJumpBarOpen(true);
  }, [setJumpBarOpen]);

  const navigateScoreOrPart = useCallback(
    (direction: -1 | 1) => {
      const scoreCount = store.getState().score?.scores?.length ?? 0;
      const nextIndex = adjacentScoreIndex(selectedScoreIndex, scoreCount, direction);
      if (nextIndex !== null) onSwitchScore(nextIndex);
    },
    [store, selectedScoreIndex, onSwitchScore],
  );

  useEditorKeyboard({
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
    onToggleRepeatStart: () => {
      const { score } = store.getState();
      if (!score) return;
      const idx = getSelectedMeasureIndex();
      if (idx === null) return;
      const gm = score.global.measures[idx];
      handleSetRepeatStart(gm?.repeatStart ? null : {});
    },
    onToggleRepeatEnd: () => {
      const { score } = store.getState();
      if (!score) return;
      const idx = getSelectedMeasureIndex();
      if (idx === null) return;
      const gm = score.global.measures[idx];
      handleSetRepeatEnd(gm?.repeatEnd ? null : {});
    },
    onEditEnding: () => {
      const { score } = store.getState();
      if (!score) return;
      const idx = getSelectedMeasureIndex();
      if (idx === null) return;
      const gm = score.global.measures[idx];
      handleSetEnding(gm?.ending ? null : { duration: 1, numbers: [1] });
    },
    onCycleBarline: () => {
      const { score } = store.getState();
      if (!score) return;
      const idx = getSelectedMeasureIndex();
      if (idx === null) return;
      const gm = score.global.measures[idx];
      const CYCLE: Barline[] = [
        { type: "regular" },
        { type: "double" },
        { type: "final" },
        { type: "dashed" },
        { type: "heavy" },
        { type: "dotted" },
      ];
      const curType = gm?.barline?.type ?? "regular";
      const curIdx = CYCLE.findIndex((b) => b.type === curType);
      const next = CYCLE[(curIdx + 1) % CYCLE.length]!;
      handleSetBarline(next);
    },
    onInsertClef: () => {
      const { score } = store.getState();
      if (!score) return;
      const CLEFS: Clef[] = [
        { sign: "G", staffPosition: -2 },
        { sign: "F", staffPosition: 2 },
        { sign: "C", staffPosition: 0 },
        { sign: "C", staffPosition: 2 },
      ];
      const idx = getSelectedMeasureIndex();
      if (idx === null) return;
      const pIdx = getSelectedPartIndex();
      const pm = score.parts[pIdx ?? 0]?.measures[idx];
      const curClef = pm?.clefs?.[0];
      const curSign = curClef?.clef?.sign ?? "G";
      const curPos = curClef?.clef?.staffPosition ?? -2;
      const curClefIdx = CLEFS.findIndex((c) => c.sign === curSign && c.staffPosition === curPos);
      const next = CLEFS[(curClefIdx + 1) % CLEFS.length]!;
      handleSetClef(next);
    },
    onTogglePanels: requestPanelToggle,
    onOpenRadialMenu: (category: RadialMenuCategory) => {
      setRadialMenu({ category, position: { ...mousePositionRef.current }, selection });
    },
    onSetTempo,
    onAddStaffText,
    onToggleCondensingPopover,
    onOpenJumpBar,
    onRepeat: handleRepeat,
    onPreviousScoreOrPart: () => navigateScoreOrPart(-1),
    onNextScoreOrPart: () => navigateScoreOrPart(1),
    onOpenPublish,
  });
}

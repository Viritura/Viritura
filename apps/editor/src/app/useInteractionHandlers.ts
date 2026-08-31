import { useCallback } from "react";
import { useAppKeyboardWiring, type TempoPopoverState, type StaffTextPopoverState } from "./useAppKeyboardWiring";
import { useJumpBarActions } from "./useJumpBarActions";
import { useLyricHandlers, type LyricStateRef } from "./useLyricHandlers";
import {
  useRadialMenuHandlers,
  type RadialMenuState,
  type RadialMenuHandlers,
} from "../radialMenu/useRadialMenuHandlers";
import { useDragAndDrop, type DragAndDropHandlers } from "./useDragAndDrop";
import { applyTupletFromRadialMenu } from "../radialMenu/applyTupletFromRadialMenu";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import type { OpenFileResult } from "../commands/fileCommands";
import type {
  Score,
  ScorePatch,
  Barline,
  Clef,
  KeySignature,
  TimeSignature,
  RepeatStart,
  RepeatEnd,
  Ending,
} from "@viritura/core";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { ActivityView } from "../components/activityRegistry";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { RefObject, MutableRefObject } from "react";
import type { useNoteInput } from "../store/noteInputStore";

type NoteInputState = ReturnType<typeof useNoteInput>["state"];
type JumpBarActions = ReturnType<typeof useJumpBarActions>;
type LyricHandlers = ReturnType<typeof useLyricHandlers>;

interface UseInteractionHandlersParams {
  // shared refs
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  rightPanelRef: RefObject<PanelImperativeHandle | null>;
  mousePositionRef: MutableRefObject<{ x: number; y: number }>;
  // shared state
  store: DocumentStore;
  selection: SelectionState;
  updateScore: (next: Score) => void;
  commitPatches: (patches: readonly ScorePatch[]) => void;
  currentZoom: number;
  selectedScoreIndex: number;
  onSwitchScore: (index: number) => void;
  noteInputState: NoteInputState;
  // editing helpers
  getSelectedMeasureIndex: () => number | null;
  getSelectedPartIndex: () => number | null;
  selectRange: (start: string, end: string) => void;
  undo: () => void;
  redo: () => void;
  // file ops
  handleOpenFile: () => void | Promise<void>;
  handleOpenProject: () => void | Promise<void>;
  handleSave: () => void | Promise<void>;
  handleSaveAs: () => void | Promise<void>;
  handleExportPdf: () => void | Promise<void>;
  handleExportSvg: () => void | Promise<void>;
  // editing ops
  handleCopy: () => void | Promise<void>;
  handleCut: () => void | Promise<void>;
  handlePaste: () => void | Promise<void>;
  handleRepeat: () => void;
  handleAddMeasures: () => void;
  handleSetRepeatStart: (value: RepeatStart | null) => void;
  handleSetRepeatEnd: (value: RepeatEnd | null) => void;
  handleSetEnding: (value: Ending | null) => void;
  handleSetBarline: (value: Barline) => void;
  handleSetClef: (value: Clef) => void;
  handleSetTimeSignature: (value: TimeSignature) => void;
  handleSetKeySignature: (value: KeySignature) => void;
  // overlay setters
  setRadialMenu: (m: RadialMenuState | null) => void;
  setTempoPopover: (s: TempoPopoverState | null) => void;
  setStaffTextPopover: (s: StaffTextPopoverState | null) => void;
  setJumpBarOpen: (open: boolean) => void;
  setLyricMode: (b: boolean) => void;
  setLyricState: (s: LyricStateRef | null) => void;
  // lyric state
  lyricMode: boolean;
  lyricState: LyricStateRef | null;
  // radial menu state
  radialMenu: RadialMenuState | null;
  // drag-and-drop
  openFolderHandle: (handle: FileSystemDirectoryHandle) => Promise<void>;
  setIsDragOver: (over: boolean) => void;
  setFileError: (err: string | null) => void;
  setOpenedFile: (file: OpenFileResult | null) => void;
  // publish
  onOpenPublish: (() => void) | undefined;
  onOpenActivity: (view: ActivityView) => void;
  /** Create a named project folder, initialize its score and history, then open Setup mode. */
  onNewScore: () => void;
}

export interface InteractionHandlers extends RadialMenuHandlers, DragAndDropHandlers {
  jumpBarActions: JumpBarActions;
  lyricNavIndex: LyricHandlers["lyricNavIndex"];
  lyricPosition: LyricHandlers["lyricPosition"];
  handleLyricCommit: LyricHandlers["handleLyricCommit"];
  handleLyricNavigate: LyricHandlers["handleLyricNavigate"];
  handleLyricExit: LyricHandlers["handleLyricExit"];
}

/**
 * Bundles editor-interaction hooks (keyboard wiring, jump bar, lyric
 * input, radial menu, drag-and-drop, tuplet-from-radial) into one
 * orchestrator. Keeps the App.tsx body from threading ~6 hook calls
 * with dozens of shared props.
 */
export function useInteractionHandlers(params: UseInteractionHandlersParams): InteractionHandlers {
  const {
    canvasRef,
    leftPanelRef,
    rightPanelRef,
    mousePositionRef,
    store,
    selection,
    updateScore,
    commitPatches,
    currentZoom,
    selectedScoreIndex,
    onSwitchScore,
    noteInputState,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
    selectRange,
    undo,
    redo,
    handleOpenFile,
    handleOpenProject,
    handleSave,
    handleSaveAs,
    handleExportPdf,
    handleExportSvg,
    handleCopy,
    handleCut,
    handlePaste,
    handleRepeat,
    handleAddMeasures,
    handleSetRepeatStart,
    handleSetRepeatEnd,
    handleSetEnding,
    handleSetBarline,
    handleSetClef,
    handleSetTimeSignature,
    handleSetKeySignature,
    setRadialMenu,
    setTempoPopover,
    setStaffTextPopover,
    setJumpBarOpen,
    setLyricMode,
    setLyricState,
    lyricMode,
    lyricState,
    radialMenu,
    openFolderHandle,
    setIsDragOver,
    setFileError,
    setOpenedFile,
    onOpenPublish,
    onOpenActivity,
    onNewScore,
  } = params;

  useAppKeyboardWiring({
    canvasRef,
    leftPanelRef,
    rightPanelRef,
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
  });

  const jumpBarActions = useJumpBarActions({
    onNewScore,
    canvasRef,
    leftPanelRef,
    rightPanelRef,
    mousePositionRef,
    store,
    selection,
    currentZoom,
    undo,
    redo,
    selectRange,
    handleOpenFile,
    handleOpenProject,
    handleSave,
    handleSaveAs,
    handleExportPdf,
    handleExportSvg,
    handleCopy,
    handleCut,
    handlePaste,
    handleRepeat,
    getSelectedMeasureIndex,
    setRadialMenu,
    setTempoPopover,
    setStaffTextPopover,
    setLyricMode,
    setLyricState,
    onOpenActivity,
    onSwitchScore,
  });

  const lyric = useLyricHandlers({
    store,
    updateScore,
    lyricMode,
    lyricState,
    setLyricMode,
    setLyricState,
    canvasRef,
  });

  const applyTupletFromRadial = useCallback(
    (tupletNum: number, customOuter?: number) => {
      const { score } = store.getState();
      if (!score) return;
      const newScore = applyTupletFromRadialMenu({
        score,
        noteInputState,
        selection,
        tupletNumber: tupletNum,
        customOuter,
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, noteInputState, selection, updateScore],
  );

  const radial = useRadialMenuHandlers({
    store,
    selectedScoreIndex,
    radialMenu,
    setRadialMenu,
    updateScore,
    commitPatches,
    applyTupletFromRadial,
    addMeasures: handleAddMeasures,
    getSelectedMeasureIndex,
    handleSetClef,
    handleSetBarline,
    handleSetTimeSignature,
    handleSetKeySignature,
    handleSetRepeatStart,
    handleSetRepeatEnd,
  });

  const dnd = useDragAndDrop({ openFolderHandle, setIsDragOver, setFileError, setOpenedFile });

  return { ...radial, ...dnd, jumpBarActions, ...lyric };
}

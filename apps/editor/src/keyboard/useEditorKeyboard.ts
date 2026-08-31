/**
 * Consolidated keyboard handler for the Viritura editor.
 *
 * ALL keyboard shortcuts are registered through `KeyboardRegistry`. The
 * registry detects (key, context) conflicts at startup and dispatches via
 * a single window listener.
 *
 * Bindings live in `editorBindings.ts`. Sub-handlers (note-input, normal-mode,
 * navigation) live in their own files and are reused as-is.
 *
 * Modal dialogs (JumpBar, LyricInput, etc.) intentionally use their own
 * capture-phase listeners — they're modal-scoped, not editor shortcuts.
 */

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { pitchToMidi } from "@viritura/core";
import { useNoteInput } from "../store/noteInputStore";
import { useSelection, useSelectionActions } from "../store/selectionStore";
import { useDocument, useDocumentActions, useDocumentStoreApi } from "../store/DocumentContext";
import { useHistoryStore } from "../store/historyStore";
import { usePlaybackActions } from "@viritura/playback";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import { buildNavigationIndex } from "../navigation/NavigationIndex";
import { selectAllRange } from "../store/selectionUtils";
import type { KeyboardHandlerContext } from "./types";
import { keyboardRegistry } from "./KeyboardRegistry";
import { buildEditorBindings } from "./editorBindings";

// ═══════════════════════════════════════════
// Config interface
// ═══════════════════════════════════════════

export interface EditorKeyboardConfig {
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  currentZoom: number;
  /** Index of the active score tab (used to resolve the active layout). */
  selectedScoreIndex?: number;
  onNewScore: () => void;
  onShowHelp: () => void;
  onOpenFile: () => void;
  onOpenMnxFile?: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onToggleRepeatStart?: () => void;
  onToggleRepeatEnd?: () => void;
  onEditEnding?: () => void;
  onCycleBarline?: () => void;
  onInsertClef?: () => void;
  onOpenRadialMenu?: (category: import("../radialMenu").RadialMenuCategory) => void;
  onSetTempo?: () => void;
  onAddStaffText?: () => void;
  onTogglePanels?: () => void;
  onToggleCondensingPopover?: () => void;
  onOpenJumpBar?: () => void;
  onRepeat?: () => void;
  onPreviousScoreOrPart?: () => void;
  onNextScoreOrPart?: () => void;
  onOpenPublish?: () => void;
}

interface CtxBindings {
  updateScore: KeyboardHandlerContext["updateScore"];
  commitPatches: KeyboardHandlerContext["commitPatches"];
  selectElement: KeyboardHandlerContext["selectElement"];
  selectRange: KeyboardHandlerContext["selectRange"];
  extendSelection: KeyboardHandlerContext["extendSelection"];
  clearSelection: KeyboardHandlerContext["clearSelection"];
  toggleNoteInput: KeyboardHandlerContext["toggleNoteInput"];
  setDuration: KeyboardHandlerContext["setDuration"];
  toggleRest: KeyboardHandlerContext["toggleRest"];
  toggleDot: KeyboardHandlerContext["toggleDot"];
  incrementDot: KeyboardHandlerContext["incrementDot"];
  setGraceType: KeyboardHandlerContext["setGraceType"];
  toggleGraceActive: KeyboardHandlerContext["toggleGraceActive"];
  toggleSlur: KeyboardHandlerContext["toggleSlur"];
  toggleTie: KeyboardHandlerContext["toggleTie"];
  setLastPitch: KeyboardHandlerContext["setLastPitch"];
  setSlurStart: KeyboardHandlerContext["setSlurStart"];
  clearSlurStart: KeyboardHandlerContext["clearSlurStart"];
  setVoice: KeyboardHandlerContext["setVoice"];
  setAccidental: KeyboardHandlerContext["setAccidental"];
  toggleChordLock: KeyboardHandlerContext["toggleChordLock"];
  setChordLock: KeyboardHandlerContext["setChordLock"];
  undo: KeyboardHandlerContext["undo"];
  redo: KeyboardHandlerContext["redo"];
  previewPitch: KeyboardHandlerContext["previewPitch"];
}

function syncCtxBindings(ctx: KeyboardHandlerContext, b: CtxBindings): void {
  ctx.updateScore = b.updateScore;
  ctx.commitPatches = b.commitPatches;
  ctx.selectElement = b.selectElement;
  ctx.selectRange = b.selectRange;
  ctx.extendSelection = b.extendSelection;
  ctx.clearSelection = b.clearSelection;
  ctx.toggleNoteInput = b.toggleNoteInput;
  ctx.setDuration = b.setDuration;
  ctx.toggleRest = b.toggleRest;
  ctx.toggleDot = b.toggleDot;
  ctx.incrementDot = b.incrementDot;
  ctx.setGraceType = b.setGraceType;
  ctx.toggleGraceActive = b.toggleGraceActive;
  ctx.toggleSlur = b.toggleSlur;
  ctx.toggleTie = b.toggleTie;
  ctx.setLastPitch = b.setLastPitch;
  ctx.setSlurStart = b.setSlurStart;
  ctx.clearSlurStart = b.clearSlurStart;
  ctx.setVoice = b.setVoice;
  ctx.setAccidental = b.setAccidental;
  ctx.toggleChordLock = b.toggleChordLock;
  ctx.setChordLock = b.setChordLock;
  ctx.previewPitch = b.previewPitch;
  ctx.undo = b.undo;
  ctx.redo = b.redo;
}

function buildAppCallbacks(configRef: {
  current: EditorKeyboardConfig;
}): Parameters<typeof buildEditorBindings>[0]["appCallbacks"] {
  return {
    onShowHelp: () => configRef.current.onShowHelp(),
    onOpenJumpBar: () => configRef.current.onOpenJumpBar?.(),
    onOpenFile: () => configRef.current.onOpenFile(),
    onOpenMnxFile: () => configRef.current.onOpenMnxFile?.(),
    onOpenPublish: () => configRef.current.onOpenPublish?.(),
    onSave: () => configRef.current.onSave(),
    onSaveAs: () => configRef.current.onSaveAs(),
    onCopy: () => configRef.current.onCopy(),
    onCut: () => configRef.current.onCut(),
    onPaste: () => configRef.current.onPaste(),
    onTogglePanels: () => configRef.current.onTogglePanels?.(),
    onToggleCondensingPopover: () => configRef.current.onToggleCondensingPopover?.(),
    onSetTempo: () => configRef.current.onSetTempo?.(),
    onAddStaffText: () => configRef.current.onAddStaffText?.(),
    onRepeat: () => configRef.current.onRepeat?.(),
    onPreviousScoreOrPart: () => configRef.current.onPreviousScoreOrPart?.(),
    onNextScoreOrPart: () => configRef.current.onNextScoreOrPart?.(),
    onOpenRadialMenu: (cat) => configRef.current.onOpenRadialMenu?.(cat),
  };
}

function installRegistry(noteInputStateRef: { current: { active: boolean } }): () => void {
  keyboardRegistry.setIsInputCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable
    );
  });
  keyboardRegistry.setContextCallback(() => (noteInputStateRef.current.active ? "noteInput" : "normal"));
  return keyboardRegistry.install();
}

// ═══════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════

export function useEditorKeyboard(config: EditorKeyboardConfig): void {
  // ─── Context hooks ──────────────────────────────
  const {
    state: noteInputState,
    toggleNoteInput,
    setDuration,
    toggleRest,
    toggleDot,
    incrementDot,
    setGraceType,
    toggleGraceActive,
    setLastPitch,
    setCursor,
    setSlurStart,
    clearSlurStart,
    toggleSlur,
    toggleTie,
    toggleChordLock,
    setChordLock,
    setVoice,
    setAccidental,
  } = useNoteInput();
  const selection = useSelection();
  const { clearSelection, selectRange, selectElement, extendSelection } = useSelectionActions();
  const { score } = useDocument();
  const documentStore = useDocumentStoreApi();
  const { updateScore, commitPatches } = useDocumentActions();
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const { previewNote } = usePlaybackActions();

  // ─── Navigation index ───────────────────────────
  const navIndex = useMemo(() => (score ? buildNavigationIndex(score) : null), [score]);

  // ─── Refs (avoid stale closures) ────────────────
  const configRef = useRef(config);
  configRef.current = config;

  const noteInputStateRef = useRef(noteInputState);
  noteInputStateRef.current = noteInputState;

  const setCursorRef = useRef(setCursor);
  setCursorRef.current = setCursor;
  const docScoreRef = useRef(score);
  docScoreRef.current = score;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const navIndexRef = useRef(navIndex);
  navIndexRef.current = navIndex;

  const previewNoteRef = useRef(previewNote);
  previewNoteRef.current = previewNote;

  // ─── Build handler context ──────────────────────
  const ctxRef = useRef<KeyboardHandlerContext>(null!);
  if (!ctxRef.current) {
    ctxRef.current = {
      getScore: () => documentStore.getState().workingScore,
      getSelection: () => selectionRef.current,
      getNavIndex: () => navIndexRef.current,
      getNoteInput: () => {
        const s = noteInputStateRef.current;
        return {
          active: s.active,
          currentVoice: s.currentVoice,
          currentDuration: s.currentDuration,
          dotCount: s.dotCount,
          currentAccidental: s.currentAccidental,
          isRest: s.isRest,
          currentGraceType: s.currentGraceType,
          lastPitch: s.lastPitch,
          cursorPosition: s.cursorPosition,
          slurActive: s.slurActive,
          slurStartEventId: s.slurStartEventId,
          chordLock: s.chordLock,
          condensingRouting: s.condensingRouting,
        };
      },
      getConfig: () => configRef.current,
      updateScore,
      commitPatches,
      selectElement,
      selectRange,
      extendSelection,
      clearSelection,
      toggleNoteInput,
      setDuration,
      toggleRest,
      toggleDot,
      incrementDot,
      setGraceType,
      toggleGraceActive,
      toggleSlur,
      toggleTie,
      setLastPitch,
      setCursor: (pos) => setCursorRef.current(pos),
      setSlurStart,
      clearSlurStart,
      setVoice,
      setAccidental,
      toggleChordLock,
      setChordLock,
      previewPitch: (pitch, partIndex) => previewNoteRef.current(pitchToMidi(pitch), partIndex, 80, 400),
      undo,
      redo,
      openRadialMenu: (cat) => configRef.current.onOpenRadialMenu?.(cat),
    };
  }
  const ctx = ctxRef.current;
  const previewPitch: KeyboardHandlerContext["previewPitch"] = (pitch, partIndex) =>
    previewNoteRef.current(pitchToMidi(pitch), partIndex, 80, 400);
  syncCtxBindings(ctx, {
    updateScore,
    commitPatches,
    selectElement,
    selectRange,
    extendSelection,
    clearSelection,
    toggleNoteInput,
    setDuration,
    toggleRest,
    toggleDot,
    incrementDot,
    setGraceType,
    toggleGraceActive,
    toggleSlur,
    toggleTie,
    setLastPitch,
    setSlurStart,
    clearSlurStart,
    setVoice,
    setAccidental,
    toggleChordLock,
    setChordLock,
    previewPitch,
    undo,
    redo,
  });

  // ─── Install registry + register bindings ──────
  useEffect(() => {
    const uninstall = installRegistry(noteInputStateRef);

    const bindings = buildEditorBindings({
      canvasRef: configRef.current.canvasRef,
      getCurrentZoom: () => configRef.current.currentZoom,
      ctx,
      appCallbacks: buildAppCallbacks(configRef),
      selectAll: () => {
        const sc = docScoreRef.current;
        if (!sc) return;
        const range = selectAllRange(sc);
        if (range) selectRange(range.startElementId, range.endElementId);
      },
      setVoice,
      toggleNoteInput,
      selectElement,
      clearSelection,
      undo,
      redo,
      setAccidental,
    });

    const teardowns = bindings.map((b) => keyboardRegistry.register(b));
    return () => {
      for (const t of teardowns) t();
      uninstall();
    };
  }, [ctx, selectRange, setVoice, toggleNoteInput, selectElement, clearSelection, undo, redo, setAccidental]);
}

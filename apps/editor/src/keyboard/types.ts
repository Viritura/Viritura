/**
 * Shared types for the decomposed keyboard handler modules.
 *
 * KeyboardHandlerContext provides a clean interface for sub-handlers
 * to access editor state and dispatch actions without knowing about
 * React refs or context internals.
 */

import type { Score, Pitch, AccidentalType, ScorePatch } from "@viritura/core";
import type { NoteValueBase } from "@viritura/core";
import type { EditorKeyboardConfig } from "./useEditorKeyboard";
import type { NavigationIndex } from "../navigation/NavigationIndex";
import type { GraceType } from "../store/noteInputStore";
import type { RadialMenuCategory } from "../radialMenu/types";
import type { Selection } from "../store/selectionStore";

export interface CursorPosition {
  measureIndex: number;
  beatPosition: number;
  partIndex: number;
  staffIndex?: number;
}

interface NoteInputSnapshot {
  active: boolean;
  currentVoice: number;
  currentDuration: NoteValueBase;
  dotCount: number;
  currentAccidental: string | null;
  isRest: boolean;
  currentGraceType: GraceType | null;
  lastPitch: Pitch | null;
  cursorPosition: CursorPosition | null;
  slurActive: boolean;
  slurStartEventId: string | null;
  /** Chord-mode lock — when on, A-G adds to the current chord rather than advancing the cursor. */
  chordLock: boolean;
  /** Active condensing-staff routing override (Alt+C popover). null = no override. */
  condensingRouting?: import("../components/CondensingPopover").CondensingMode | null;
}

export interface KeyboardHandlerContext {
  // State getters (read from refs internally)
  getScore: () => Score | null;
  getSelection: () => Selection;
  getNavIndex: () => NavigationIndex | null;
  getNoteInput: () => NoteInputSnapshot;
  getConfig: () => EditorKeyboardConfig;

  // Score actions
  updateScore: (score: Score, affectedMeasures?: { start: number; end: number }) => void;
  commitPatches: (patches: readonly ScorePatch[], affectedMeasures?: { start: number; end: number }) => void;

  // Selection actions
  selectElement: (id: string) => void;
  selectRange: (start: string, end: string) => void;
  extendSelection: (id: string) => void;
  clearSelection: () => void;

  // Note input actions
  toggleNoteInput: () => void;
  setDuration: (dur: NoteValueBase) => void;
  toggleRest: () => void;
  toggleDot: () => void;
  incrementDot: () => void;
  setGraceType: (type: GraceType) => void;
  toggleGraceActive: () => void;
  toggleSlur: () => void;
  toggleTie: () => void;
  setLastPitch: (pitch: Pitch) => void;
  setCursor: (pos: CursorPosition) => void;
  setSlurStart: (id: string) => void;
  clearSlurStart: () => void;
  setVoice: (v: 1 | 2 | 3 | 4) => void;
  setAccidental: (accidental: AccidentalType | null) => void;
  toggleChordLock: () => void;
  setChordLock: (enabled: boolean) => void;

  // Audio preview
  previewPitch: (pitch: Pitch, partIndex?: number) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Radial menu
  openRadialMenu?: (category: RadialMenuCategory) => void;
}

/**
 * Note-input store.
 *
 * Module-level zustand store that owns the editor's note-input mode
 * (active flag, duration, accidental, rest mode, dot count, voice, grace,
 * tie/slur toggles, chord lock, last pitch, cursor position, condensing
 * routing). Replaces the prior `NoteInputContext` + `NoteInputProvider`
 * pair — there is now exactly one note-input slice for the entire app, and
 * consumers subscribe via the `useNoteInput()` compat hook (returns the
 * full state + action bundle, matching the historical Context API surface).
 *
 * The pure `noteInputReducer` is kept exported so unit tests can exercise
 * state transitions without going through React.
 */

import { useMemo } from "react";
import { create } from "zustand";
import type { NoteValueBase, AccidentalType, Pitch } from "@viritura/core";
import type { CondensingMode } from "../components/CondensingPopover";

// ═══════════════════════════════════════════
// State
// ═══════════════════════════════════════════

export type GraceType = "grace" | "appoggiatura";
export type Voice = 1 | 2 | 3 | 4;
export type DotCount = 0 | 1 | 2 | 3 | 4;
/** Non-zero dot counts — the picker's selectable values. */
type SelectedDotCount = 1 | 2 | 3 | 4;

/** Tracks the current input cursor position within the score. */
export interface CursorPosition {
  /** Which measure the cursor is in (0-based) */
  measureIndex: number;
  /** Beat offset within the measure (in quarter-note beats) */
  beatPosition: number;
  /** Which part the cursor is in (0-based) */
  partIndex: number;
  /** Which staff the cursor is on (0-based, for grand staff instruments). Defaults to 0. */
  staffIndex?: number;
}

export interface NoteInputState {
  /** Whether note input mode is active */
  active: boolean;
  /** Selected note duration */
  currentDuration: NoteValueBase;
  /** Selected accidental (null = none) */
  currentAccidental: AccidentalType | null;
  /** Rest mode active */
  isRest: boolean;
  /** Number of augmentation dots applied to incoming notes (0 = none). */
  dotCount: DotCount;
  /**
   * Picker memory for the dot button: which non-zero dot count the user
   * last chose. Toggling the dot button off then on restores this value
   * instead of snapping back to 1. Updated whenever `SET_DOT_COUNT` /
   * `INCREMENT_DOT` produce a non-zero result.
   */
  selectedDotCount: SelectedDotCount;
  /** Active voice (1-4) */
  currentVoice: Voice;
  /** Grace note type currently applied (null = normal note). */
  currentGraceType: GraceType | null;
  /**
   * Picker memory for the grace button: which grace type the user last
   * chose. Toggling grace off then on restores this value. Updated
   * whenever `SET_GRACE_TYPE` runs.
   */
  selectedGraceType: GraceType;
  /** Tie toggle active */
  tieActive: boolean;
  /** Slur toggle active */
  slurActive: boolean;
  /** Event ID where the current slur starts (null = no pending slur) */
  slurStartEventId: string | null;
  /** Chord-mode lock: when on, A-G adds to the current chord instead of advancing the cursor (standard Q mode). */
  chordLock: boolean;
  /** Last entered pitch for octave memory (null = use default) */
  lastPitch: Pitch | null;
  /** Current input cursor position (null when not in note input mode) */
  cursorPosition: CursorPosition | null;
  /** Condensing routing mode for input on condensed staves (null = smart default) */
  condensingRouting: CondensingMode | null;
}

export const initialNoteInputState: NoteInputState = {
  active: false,
  currentDuration: "quarter",
  currentAccidental: null,
  isRest: false,
  dotCount: 0,
  selectedDotCount: 1,
  currentVoice: 1,
  currentGraceType: null,
  selectedGraceType: "grace",
  tieActive: false,
  slurActive: false,
  slurStartEventId: null,
  chordLock: false,
  lastPitch: null,
  cursorPosition: null,
  condensingRouting: null,
};

// ═══════════════════════════════════════════
// Actions (discriminated-union dispatch)
// ═══════════════════════════════════════════

export type NoteInputAction =
  | { type: "TOGGLE_NOTE_INPUT" }
  | { type: "SET_DURATION"; duration: NoteValueBase }
  | { type: "SET_ACCIDENTAL"; accidental: AccidentalType | null }
  | { type: "TOGGLE_REST" }
  | { type: "TOGGLE_DOT" }
  | { type: "TOGGLE_DOT_ACTIVE" }
  | { type: "INCREMENT_DOT" }
  | { type: "SET_DOT_COUNT"; dotCount: DotCount }
  | { type: "SET_VOICE"; voice: Voice }
  | { type: "SET_GRACE_TYPE"; graceType: GraceType }
  | { type: "TOGGLE_GRACE_ACTIVE" }
  | { type: "TOGGLE_TIE" }
  | { type: "TOGGLE_SLUR" }
  | { type: "SET_SLUR_START"; eventId: string }
  | { type: "CLEAR_SLUR_START" }
  | { type: "TOGGLE_CHORD_LOCK" }
  | { type: "SET_CHORD_LOCK"; enabled: boolean }
  | { type: "SET_LAST_PITCH"; pitch: Pitch }
  | { type: "CLEAR_LAST_PITCH" }
  | { type: "SET_CURSOR"; position: CursorPosition }
  | { type: "CLEAR_CURSOR" }
  | { type: "SET_CONDENSING_ROUTING"; mode: CondensingMode | null }
  | { type: "RESET" };

// ═══════════════════════════════════════════
// Reducer (kept as a pure function for direct unit testing)
// ═══════════════════════════════════════════

/** Reducer slice for toggles + duration / accidental / voice / grace inputs. */
function inputModeReducer(state: NoteInputState, action: NoteInputAction): NoteInputState | null {
  switch (action.type) {
    case "TOGGLE_NOTE_INPUT":
      if (state.active) {
        // Turning off: reset rest, grace, cursor, pending slur, chord lock, and condensing routing
        return {
          ...state,
          active: false,
          isRest: false,
          currentGraceType: null,
          slurStartEventId: null,
          chordLock: false,
          cursorPosition: null,
          condensingRouting: null,
        };
      }
      // Turning on: active becomes true (cursor set externally via SET_CURSOR)
      return { ...state, active: true };

    case "SET_DURATION":
      return { ...state, currentDuration: action.duration, dotCount: 0 };

    case "SET_ACCIDENTAL":
      // Toggle off if same accidental is selected again
      return {
        ...state,
        currentAccidental: state.currentAccidental === action.accidental ? null : action.accidental,
      };

    case "TOGGLE_REST":
      return {
        ...state,
        isRest: !state.isRest,
        // Grace notes require a pitched note; entering rest mode must not
        // leave the toolbar advertising an impossible grace-rest state.
        currentGraceType: !state.isRest ? null : state.currentGraceType,
      };

    case "TOGGLE_DOT":
      // Toggle between 0 and the picker's currently-selected dot count.
      return {
        ...state,
        dotCount: state.dotCount === 0 ? state.selectedDotCount : 0,
      };

    case "TOGGLE_DOT_ACTIVE":
      return {
        ...state,
        dotCount: state.dotCount > 0 ? 0 : state.selectedDotCount,
      };

    case "INCREMENT_DOT": {
      const next = ((state.dotCount + 1) % 5) as DotCount;
      return {
        ...state,
        dotCount: next,
        selectedDotCount: next > 0 ? (next as SelectedDotCount) : state.selectedDotCount,
      };
    }

    case "SET_DOT_COUNT":
      return {
        ...state,
        dotCount: action.dotCount,
        selectedDotCount: action.dotCount > 0 ? (action.dotCount as SelectedDotCount) : state.selectedDotCount,
      };

    case "SET_VOICE":
      return { ...state, currentVoice: action.voice };

    case "SET_GRACE_TYPE":
      // Picking a grace type both activates it AND records it as the
      // picker memory. Use TOGGLE_GRACE_ACTIVE for on/off cycling.
      return {
        ...state,
        isRest: false,
        currentGraceType: action.graceType,
        selectedGraceType: action.graceType,
      };

    case "TOGGLE_GRACE_ACTIVE":
      return {
        ...state,
        isRest: state.currentGraceType === null ? false : state.isRest,
        currentGraceType: state.currentGraceType === null ? state.selectedGraceType : null,
      };

    case "RESET":
      return initialNoteInputState;
    default:
      return null;
  }
}

/** Reducer slice for cursor, ties, slurs, chord lock, pitch memory, condensing. */
function inputCursorReducer(state: NoteInputState, action: NoteInputAction): NoteInputState | null {
  switch (action.type) {
    case "SET_CURSOR":
      return { ...state, cursorPosition: action.position };

    case "CLEAR_CURSOR":
      return { ...state, cursorPosition: null };

    case "TOGGLE_TIE":
      return { ...state, tieActive: !state.tieActive };

    case "TOGGLE_SLUR":
      // Toggling slur off also clears any pending slur start
      return {
        ...state,
        slurActive: !state.slurActive,
        slurStartEventId: state.slurActive ? null : state.slurStartEventId,
      };

    case "SET_SLUR_START":
      return { ...state, slurStartEventId: action.eventId };

    case "CLEAR_SLUR_START":
      return { ...state, slurStartEventId: null };

    case "TOGGLE_CHORD_LOCK":
      return { ...state, chordLock: !state.chordLock };

    case "SET_CHORD_LOCK":
      return { ...state, chordLock: action.enabled };

    case "SET_LAST_PITCH":
      return { ...state, lastPitch: action.pitch };

    case "CLEAR_LAST_PITCH":
      return { ...state, lastPitch: null };

    case "SET_CONDENSING_ROUTING":
      return { ...state, condensingRouting: action.mode };

    default:
      return null;
  }
}

export function noteInputReducer(state: NoteInputState, action: NoteInputAction): NoteInputState {
  return inputModeReducer(state, action) ?? inputCursorReducer(state, action) ?? state;
}

// ═══════════════════════════════════════════
// Zustand store
// ═══════════════════════════════════════════

interface NoteInputStore extends NoteInputState {
  _dispatch: (action: NoteInputAction) => void;
}

const useNoteInputStore = create<NoteInputStore>()((set) => ({
  ...initialNoteInputState,
  _dispatch: (action) => set((s) => noteInputReducer(s, action)),
}));

export { useNoteInputStore };

/** Dispatch an action against the store from outside React (commands, tests). */
function dispatchNoteInput(action: NoteInputAction): void {
  useNoteInputStore.getState()._dispatch(action);
}

/** Reset the store to its initial state (primarily for test isolation). */
export function resetNoteInputStore(): void {
  useNoteInputStore.setState(
    {
      ...initialNoteInputState,
      _dispatch: (action) => useNoteInputStore.setState((s) => noteInputReducer(s, action)),
    },
    true,
  );
}

// ═══════════════════════════════════════════
// Compat hook + bundled action surface
// ═══════════════════════════════════════════

/** Bundled state + action methods. Matches the historical Context value. */
export interface NoteInputContextValue {
  state: NoteInputState;
  dispatch: (action: NoteInputAction) => void;
  toggleNoteInput: () => void;
  setDuration: (duration: NoteValueBase) => void;
  setAccidental: (accidental: AccidentalType | null) => void;
  toggleRest: () => void;
  toggleDot: () => void;
  toggleDotActive: () => void;
  incrementDot: () => void;
  setDotCount: (dotCount: DotCount) => void;
  setVoice: (voice: Voice) => void;
  setGraceType: (graceType: GraceType) => void;
  toggleGraceActive: () => void;
  toggleTie: () => void;
  toggleSlur: () => void;
  setSlurStart: (eventId: string) => void;
  clearSlurStart: () => void;
  toggleChordLock: () => void;
  setChordLock: (enabled: boolean) => void;
  setLastPitch: (pitch: Pitch) => void;
  clearLastPitch: () => void;
  setCursor: (position: CursorPosition) => void;
  clearCursor: () => void;
  setCondensingRouting: (mode: CondensingMode | null) => void;
  reset: () => void;
}

/** Stable action methods — module-scoped so identity never changes. */
const actions = {
  toggleNoteInput: () => dispatchNoteInput({ type: "TOGGLE_NOTE_INPUT" }),
  setDuration: (duration: NoteValueBase) => dispatchNoteInput({ type: "SET_DURATION", duration }),
  setAccidental: (accidental: AccidentalType | null) => dispatchNoteInput({ type: "SET_ACCIDENTAL", accidental }),
  toggleRest: () => dispatchNoteInput({ type: "TOGGLE_REST" }),
  toggleDot: () => dispatchNoteInput({ type: "TOGGLE_DOT" }),
  toggleDotActive: () => dispatchNoteInput({ type: "TOGGLE_DOT_ACTIVE" }),
  incrementDot: () => dispatchNoteInput({ type: "INCREMENT_DOT" }),
  setDotCount: (dotCount: DotCount) => dispatchNoteInput({ type: "SET_DOT_COUNT", dotCount }),
  setVoice: (voice: Voice) => dispatchNoteInput({ type: "SET_VOICE", voice }),
  setGraceType: (graceType: GraceType) => dispatchNoteInput({ type: "SET_GRACE_TYPE", graceType }),
  toggleGraceActive: () => dispatchNoteInput({ type: "TOGGLE_GRACE_ACTIVE" }),
  toggleTie: () => dispatchNoteInput({ type: "TOGGLE_TIE" }),
  toggleSlur: () => dispatchNoteInput({ type: "TOGGLE_SLUR" }),
  setSlurStart: (eventId: string) => dispatchNoteInput({ type: "SET_SLUR_START", eventId }),
  clearSlurStart: () => dispatchNoteInput({ type: "CLEAR_SLUR_START" }),
  toggleChordLock: () => dispatchNoteInput({ type: "TOGGLE_CHORD_LOCK" }),
  setChordLock: (enabled: boolean) => dispatchNoteInput({ type: "SET_CHORD_LOCK", enabled }),
  setLastPitch: (pitch: Pitch) => dispatchNoteInput({ type: "SET_LAST_PITCH", pitch }),
  clearLastPitch: () => dispatchNoteInput({ type: "CLEAR_LAST_PITCH" }),
  setCursor: (position: CursorPosition) => dispatchNoteInput({ type: "SET_CURSOR", position }),
  clearCursor: () => dispatchNoteInput({ type: "CLEAR_CURSOR" }),
  setCondensingRouting: (mode: CondensingMode | null) => dispatchNoteInput({ type: "SET_CONDENSING_ROUTING", mode }),
  reset: () => dispatchNoteInput({ type: "RESET" }),
} as const;

/** Stable module-level note-input action callbacks (identity never changes). */
export const noteInputActions = actions;

/**
 * Compat hook — returns the full `{ state, dispatch, ...actions }` bundle
 * that the historical Context value exposed. New code should prefer
 * fine-grained selectors via `useNoteInputStore(s => …)` directly.
 */
export function useNoteInput(): NoteInputContextValue {
  // Read individual primitive slices so the hook re-renders on any change
  // but the selector itself stays referentially stable across renders.
  const active = useNoteInputStore((s) => s.active);
  const currentDuration = useNoteInputStore((s) => s.currentDuration);
  const currentAccidental = useNoteInputStore((s) => s.currentAccidental);
  const isRest = useNoteInputStore((s) => s.isRest);
  const dotCount = useNoteInputStore((s) => s.dotCount);
  const selectedDotCount = useNoteInputStore((s) => s.selectedDotCount);
  const currentVoice = useNoteInputStore((s) => s.currentVoice);
  const currentGraceType = useNoteInputStore((s) => s.currentGraceType);
  const selectedGraceType = useNoteInputStore((s) => s.selectedGraceType);
  const tieActive = useNoteInputStore((s) => s.tieActive);
  const slurActive = useNoteInputStore((s) => s.slurActive);
  const slurStartEventId = useNoteInputStore((s) => s.slurStartEventId);
  const chordLock = useNoteInputStore((s) => s.chordLock);
  const lastPitch = useNoteInputStore((s) => s.lastPitch);
  const cursorPosition = useNoteInputStore((s) => s.cursorPosition);
  const condensingRouting = useNoteInputStore((s) => s.condensingRouting);

  const state = useMemo<NoteInputState>(
    () => ({
      active,
      currentDuration,
      currentAccidental,
      isRest,
      dotCount,
      selectedDotCount,
      currentVoice,
      currentGraceType,
      selectedGraceType,
      tieActive,
      slurActive,
      slurStartEventId,
      chordLock,
      lastPitch,
      cursorPosition,
      condensingRouting,
    }),
    [
      active,
      currentDuration,
      currentAccidental,
      isRest,
      dotCount,
      selectedDotCount,
      currentVoice,
      currentGraceType,
      selectedGraceType,
      tieActive,
      slurActive,
      slurStartEventId,
      chordLock,
      lastPitch,
      cursorPosition,
      condensingRouting,
    ],
  );

  return useMemo(() => ({ state, dispatch: dispatchNoteInput, ...actions }), [state]);
}

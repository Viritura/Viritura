import type { NoteValueBase, AccidentalType } from "@viritura/core";
import type { NoteInputAction, Voice, GraceType } from "../store/noteInputStore";

/** Keyboard-number to duration mapping shown by the note-input toolbar. */
export const DURATION_KEY_MAP: Record<string, NoteValueBase> = {
  "1": "64th",
  "2": "32nd",
  "3": "16th",
  "4": "eighth",
  "5": "quarter",
  "6": "half",
  "7": "whole",
  "8": "breve",
  "9": "maxima",
};

/**
 * Create a TOGGLE_NOTE_INPUT action.
 */
export function toggleNoteInputAction(): NoteInputAction {
  return { type: "TOGGLE_NOTE_INPUT" };
}

/**
 * Create a SET_DURATION action from a keyboard number key.
 * Returns null if the key is not a valid duration key.
 */
export function durationFromKey(key: string): NoteInputAction | null {
  const duration = DURATION_KEY_MAP[key];
  if (!duration) return null;
  return { type: "SET_DURATION", duration };
}

/**
 * Create a SET_DURATION action.
 */
export function setDurationAction(duration: NoteValueBase): NoteInputAction {
  return { type: "SET_DURATION", duration };
}

/**
 * Create a SET_ACCIDENTAL action.
 */
export function setAccidentalAction(accidental: AccidentalType | null): NoteInputAction {
  return { type: "SET_ACCIDENTAL", accidental };
}

/**
 * Create a TOGGLE_REST action.
 */
export function toggleRestAction(): NoteInputAction {
  return { type: "TOGGLE_REST" };
}

/**
 * Create a TOGGLE_DOT action.
 */
export function toggleDotAction(): NoteInputAction {
  return { type: "TOGGLE_DOT" };
}

/**
 * Create a SET_VOICE action.
 */
export function setVoiceAction(voice: Voice): NoteInputAction {
  return { type: "SET_VOICE", voice };
}

/**
 * Create a SET_GRACE_TYPE action.
 */
export function setGraceTypeAction(graceType: GraceType): NoteInputAction {
  return { type: "SET_GRACE_TYPE", graceType };
}

/**
 * Create a RESET action.
 */
export function resetAction(): NoteInputAction {
  return { type: "RESET" };
}

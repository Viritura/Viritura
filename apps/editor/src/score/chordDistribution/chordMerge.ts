/**
 * Merging pitches into an existing chord.
 *
 * Shared by paste-and-merge (manual reduce) and by any future command that adds
 * voices to existing material rather than replacing it. Merging is pitch-keyed
 * and order-preserving: duplicates of a pitch already in the chord are dropped
 * rather than producing a unison notehead pair, and the result is re-sorted
 * low-to-high so the chord stacks the way the engraver expects.
 */

import { isRest, pitchToMidi, type Note, type NoteEvent } from "@viritura/core";
import { generateNoteId } from "../../commands/noteCommands";
import { pitchKey } from "./allocation";

/** Clone a note for a new chord, dropping the identity-bound fields. */
export function cloneNoteForChord(note: Note): Note {
  const { id: _id, ties: _ties, ...rest } = note;
  return { ...structuredClone(rest), id: generateNoteId() } as Note;
}

/**
 * Add `incoming` pitches to `target` in place. A rest becomes a chord of the
 * incoming notes. Returns true when the event actually changed.
 */
export function mergeNotesIntoEvent(target: NoteEvent, incoming: readonly Note[]): boolean {
  if (incoming.length === 0) return false;
  const existing = isRest(target) ? [] : (target.notes ?? []);
  const seen = new Set(existing.map((note) => pitchKey(note.pitch)));
  const added = incoming.filter((note) => !seen.has(pitchKey(note.pitch))).map(cloneNoteForChord);
  if (added.length === 0) return false;

  const merged = [...existing, ...added].sort((left, right) => pitchToMidi(left.pitch) - pitchToMidi(right.pitch));
  delete (target as { rest?: unknown }).rest;
  target.notes = merged;
  return true;
}

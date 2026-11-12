import type { Note, NoteEvent, NoteheadShape } from "@viritura/core";

/**
 * Notehead shapes that mark a pitched-staff note as unpitched: X / circle-X
 * (claps, taps, spoken or percussive extended techniques) and rhythmic slash.
 * Diamond (harmonics) and triangle (shape notes) still denote a pitch.
 */
const UNPITCHED_NOTEHEADS: ReadonlySet<NoteheadShape> = new Set(["x", "circleX", "slash"]);

function isSoundingNote(note: Note): boolean {
  return note.notehead === undefined || !UNPITCHED_NOTEHEADS.has(note.notehead);
}

/**
 * Drop pitched notes whose notehead marks them as unpitched. MIDI playback
 * cannot reproduce those techniques, and sounding the staff pitch would be
 * wrong. Kit notes are untouched: percussion maps assign them real sounds.
 */
export function withSoundingNotes(event: NoteEvent): NoteEvent {
  const notes = event.notes;
  if (!notes?.some((note) => !isSoundingNote(note))) return event;
  return { ...event, notes: notes.filter(isSoundingNote) };
}

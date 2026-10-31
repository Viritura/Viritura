import { generateId, type Duration, type NoteEvent } from "@viritura/core";
import { current, isDraft } from "immer";

/** The onset owns syllables and attack markings; continuations retain the final release notation. */
export function eventDurationFragment(event: NoteEvent, duration: Duration, previous?: NoteEvent): NoteEvent {
  const piece = structuredClone(isDraft(event) ? current(event) : event);
  piece.duration = structuredClone(isDraft(duration) ? current(duration) : duration);
  piece.id = previous ? generateId() : (event.id ?? generateId());
  for (const kind of ["notes", "kitNotes"] as const) {
    for (const [index, note] of (piece[kind] ?? []).entries()) {
      note.id = previous ? generateId() : (note.id ?? generateId());
      const previousNote = previous?.[kind]?.[index];
      if (previousNote) previousNote.ties = [{ target: note.id }];
    }
  }
  if (previous) {
    delete piece.slurs;
    delete piece.markings;
    delete piece.lyrics;
    delete previous.fermata;
    delete previous.glissandos;
  }
  return piece;
}

export function splitEventDurations(event: NoteEvent, durations: readonly Duration[]): NoteEvent[] {
  const source = isDraft(event) ? current(event) : event;
  let previous: NoteEvent | undefined;
  return durations.map((duration) => {
    const piece = eventDurationFragment(source, duration, previous);
    previous = piece;
    return piece;
  });
}

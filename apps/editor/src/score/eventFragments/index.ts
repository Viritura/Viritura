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
    retainFermataOnFragment(event, previous, piece);
    delete previous.glissandos;
  }

  function retainFermataOnFragment(source: NoteEvent, previous: NoteEvent, piece: NoteEvent): void {
    if (source.fermata?._x?.viritura?.globalFermataId !== "clipboard-projection") {
      delete previous.fermata;
      return;
    }
    if (piece.fermata?._x?.viritura?.localOnly) {
      delete piece.fermata._x.viritura.globalFermataId;
      delete (piece.fermata._x.viritura as Record<string, unknown>)["clipboardFermataOffsets"];
    } else delete piece.fermata;
    if (previous.fermata?._x?.viritura?.globalFermataId === "clipboard-projection") {
      previous.fermata = {
        _x: { ...previous.fermata._x, viritura: { ...previous.fermata._x.viritura, localOnly: false } },
      };
    } else delete previous.fermata;
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

/**
 * Notehead-level refinement of an existing selection.
 *
 * A chord selection addresses whole events, which is the right granularity for
 * articulations or transposition but the wrong one for manual explode/reduce:
 * moving the top line of a divisi passage onto another staff means selecting
 * *one notehead per chord* and cutting it. These helpers narrow any selection
 * to a specific voice of the stack — top, bottom, or the nth from the top — so
 * the existing cut/copy/paste path can do the rest.
 */

import type { NoteEvent, Score } from "@viritura/core";
import { pitchToMidi } from "@viritura/core";
import { eventId, eventSuffix, getEventAtLocation, noteheadId, type EventLocation } from "../score/ElementPath";
import { resolveSelectionNotes } from "./selectionUtils";
import type { Selection } from "./selectionStore";

/** Which line of the chord stack to isolate. */
export type ChordEdge = "top" | "bottom";

function elementIdForEvent(loc: EventLocation, event: NoteEvent): string {
  const suffix = eventSuffix(event.id, loc.eventIndex, loc.measureIndex, loc.sequenceIndex);
  return eventId(loc.partIndex, loc.measureIndex, loc.sequenceIndex, suffix);
}

/**
 * Note indices of `event`, ordered highest-sounding first. Chords are stored
 * low-to-high by convention but nothing enforces it, so sort rather than assume.
 */
function noteIndicesTopDown(event: NoteEvent): number[] {
  const notes = event.notes ?? [];
  return notes
    .map((note, index) => ({ index, midi: pitchToMidi(note.pitch) }))
    .sort((left, right) => right.midi - left.midi || left.index - right.index)
    .map((entry) => entry.index);
}

/**
 * Element IDs for the nth notehead from the top of every chord the selection
 * covers. `depth` 0 is the top note; `edge: "bottom"` counts from the bottom
 * instead. Events with fewer notes than `depth` are skipped, and rests are
 * always skipped, so a passage of mixed chord sizes still yields a usable line.
 */
export function chordLineNoteIds(score: Score, selection: Selection, edge: ChordEdge, depth = 0): string[] {
  const ids: string[] = [];
  for (const target of resolveSelectionNotes(selection, score)) {
    const event = getEventAtLocation(score, target.loc);
    if (!event || event.type !== "event" || !event.notes || event.notes.length === 0) continue;
    const ordered = noteIndicesTopDown(event);
    const noteIndex = edge === "top" ? ordered[depth] : ordered[ordered.length - 1 - depth];
    if (noteIndex === undefined) continue;
    ids.push(noteheadId(elementIdForEvent(target.loc, event), noteIndex));
  }
  return ids;
}

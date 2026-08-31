/**
 * Deleting one notehead out of a chord.
 *
 * A chord is a stack of independent notes sharing a stem, and selecting one of
 * them selects that note — not the chord. Pressing Delete therefore removes
 * that note and leaves the rest of the chord sounding; the event only becomes a
 * rest when its last note goes. This mirrors what the accidental and
 * articulation commands already do with notehead ids, where a single selected
 * notehead is the only note affected.
 *
 * Removing a note can orphan things that pointed at it: a tie on an earlier
 * note whose target was this note, and the `startNote` / `endNote` refinement
 * on a slur. Ties are dropped (a tie to nothing is not a tie), while a slur
 * keeps its event-to-event span and only loses the notehead refinement — the
 * phrase mark the user drew is still meaningful without it.
 */

import type { Score, NoteEvent } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import { resolveEventLocation, getEventAtLocation } from "../score/ElementPath";

/** Matches the trailing `/n{index}` segment the engine tags noteheads with. */
const NOTEHEAD_SUFFIX = /\/n(\d+)$/;

/** True when `elementId` names one notehead of an event rather than the event. */
export function isNoteheadId(elementId: string): boolean {
  return NOTEHEAD_SUFFIX.test(elementId);
}

/**
 * Group notehead ids by their owning event's element id, so every notehead of
 * one chord is decided together: taking two of a triad's three notes is a
 * partial removal, taking all three empties the event.
 *
 * Ids that aren't noteheads are ignored, which lets callers pass a whole
 * selection through unfiltered.
 */
export function groupNoteheadsByEvent(elementIds: readonly string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const id of elementIds) {
    const match = id.match(NOTEHEAD_SUFFIX);
    if (!match) continue;
    const eventId = id.slice(0, match.index);
    const noteIndex = parseInt(match[1]!, 10);
    const bucket = groups.get(eventId);
    if (bucket) {
      if (!bucket.includes(noteIndex)) bucket.push(noteIndex);
    } else {
      groups.set(eventId, [noteIndex]);
    }
  }
  return groups;
}

/**
 * What happened — or should happen — to the event a removal was aimed at.
 *
 * `wholeEvent` means the selection covers every note the event has, so there is
 * no chord left to thin out. The caller finishes the job through its normal
 * event-delete path, which replaces the event with a rest of the same duration
 * and merges adjacent rests — logic this command deliberately doesn't
 * duplicate.
 */
export type ChordNoteRemoval = "removed" | "wholeEvent" | "none";

/**
 * Remove `noteIndexes` from the event addressed by `eventElementId`, mutating
 * `score` in place.
 */
export function removeChordNotes(
  score: Score,
  eventElementId: string,
  noteIndexes: readonly number[],
): ChordNoteRemoval {
  const loc = resolveEventLocation(eventElementId, score);
  if (!loc) return "none";
  const event = getEventAtLocation(score, loc);
  if (!event || event.type !== "event") return "none";
  const notes = event.notes;
  if (!notes || notes.length === 0) return "none";

  const targets = [...new Set(noteIndexes)].filter((i) => i >= 0 && i < notes.length);
  if (targets.length === 0) return "none";
  if (targets.length >= notes.length) return "wholeEvent";

  const removedIds = new Set<string>();
  // Descending so each splice leaves the lower indices addressing the same notes.
  for (const index of [...targets].sort((a, b) => b - a)) {
    const id = notes[index]!.id;
    if (id) removedIds.add(id);
    notes.splice(index, 1);
  }

  if (removedIds.size > 0) dropReferencesToNotes(score, removedIds);
  return "removed";
}

/**
 * Remove the note named by a notehead element id (`{event}/n{index}`) from its
 * chord, mutating `score`. The convenience entry point for the delete paths,
 * which hold an element id rather than an event id and index.
 */
export function removeChordNoteById(score: Score, elementId: string): ChordNoteRemoval {
  const match = elementId.match(NOTEHEAD_SUFFIX);
  if (!match) return "none";
  return removeChordNotes(score, elementId.slice(0, match.index), [parseInt(match[1]!, 10)]);
}

/**
 * Thin every chord named by a notehead id in `elementIds`, mutating `score`.
 *
 * `wholeEventIds` is read *and* written: an event already selected in full is
 * left to the caller's event-level pass, and a chord whose noteheads are all
 * selected is appended to it — selecting every note of a chord means the rest,
 * not a chord with nothing in it. Returns true when at least one note went.
 */
export function thinSelectedChords(score: Score, elementIds: readonly string[], wholeEventIds: string[]): boolean {
  const alreadyWhole = new Set(wholeEventIds);
  let removed = false;
  for (const [eventId, noteIndexes] of groupNoteheadsByEvent(elementIds)) {
    if (alreadyWhole.has(eventId)) continue;
    const outcome = removeChordNotes(score, eventId, noteIndexes);
    if (outcome === "removed") removed = true;
    else if (outcome === "wholeEvent") wholeEventIds.push(eventId);
  }
  return removed;
}

/** Drop ties aimed at a removed note and slur endpoints that named one. */
function dropReferencesToNotes(score: Score, removedIds: ReadonlySet<string>): void {
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          pruneEventReferences(event, removedIds);
        }
      }
    }
  }
}

function pruneEventReferences(event: NoteEvent, removedIds: ReadonlySet<string>): void {
  for (const note of event.notes ?? []) {
    if (!note.ties) continue;
    const kept = note.ties.filter((tie) => !(tie.target !== undefined && removedIds.has(tie.target)));
    if (kept.length === note.ties.length) continue;
    if (kept.length === 0) delete note.ties;
    else note.ties = kept;
  }

  for (const slur of event.slurs ?? []) {
    if (slur.startNote !== undefined && removedIds.has(slur.startNote)) delete slur.startNote;
    if (slur.endNote !== undefined && removedIds.has(slur.endNote)) delete slur.endNote;
  }
}

/**
 * Internal locator helpers used by the patch interpreters.
 *
 * Patches address events by MNX id. The interpreters need to translate those
 * ids into mutable handles inside the Score tree. Lookups walk the structural
 * path defined by `SequencePath` to the sequence, then recursively descend
 * into the sequence's content (including tuplets, grace groups, and tremolos)
 * looking for the matching event id.
 *
 * Scans are linear because measures are bounded (a few dozen events at most)
 * and the patch surface doesn't justify a per-Score id index yet.
 */

import type { Score } from "../model/score";
import type { NoteEvent, Sequence, SequenceContent } from "../model/event";
import type { EventLocator, SequencePath } from "./types";

export class PatchTargetMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchTargetMissing";
  }
}

function findSequence(score: Score, path: SequencePath): Sequence {
  const part = score.parts.find((p) => p.id === path.partId);
  if (!part) throw new PatchTargetMissing(`Part "${path.partId}" not found`);
  const measure = part.measures[path.measureIndex];
  if (!measure) {
    throw new PatchTargetMissing(`Measure ${path.measureIndex} not found in part "${path.partId}"`);
  }
  const sequence = measure.sequences[path.voice];
  if (!sequence) {
    throw new PatchTargetMissing(`Voice ${path.voice} not found in part "${path.partId}" measure ${path.measureIndex}`);
  }
  return sequence;
}

/**
 * Recursively search nested content arrays (tuplet, grace, tremolo containers)
 * for the event with `eventId`. Returns the containing array and the index
 * within it, so callers can splice into the right place.
 */
function findEventInContent(
  content: SequenceContent[],
  eventId: string,
): { container: SequenceContent[]; index: number } | null {
  for (let i = 0; i < content.length; i++) {
    const item = content[i]!;
    if (item.type === "event" && item.id === eventId) {
      return { container: content, index: i };
    }
    if (item.type === "tuplet") {
      const hit = findEventInContent(item.content, eventId);
      if (hit) return hit;
    } else if (item.type === "grace") {
      const hit = findEventInContent(item.content as SequenceContent[], eventId);
      if (hit) return hit;
    } else if (item.type === "tremolo") {
      const hit = findEventInContent(item.content as SequenceContent[], eventId);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Returns the content array that directly owns the event with `eventId`,
 * walking into nested tuplets/grace/tremolo containers as needed.
 */
export function findOwningContentArray(
  score: Score,
  locator: EventLocator,
): { container: SequenceContent[]; index: number } {
  const sequence = findSequence(score, locator.sequencePath);
  const hit = findEventInContent(sequence.content, locator.eventId);
  if (!hit) {
    throw new PatchTargetMissing(`Event "${locator.eventId}" not found in sequence`);
  }
  return hit;
}

export function findEvent(score: Score, locator: EventLocator): NoteEvent {
  const { container, index } = findOwningContentArray(score, locator);
  return container[index] as NoteEvent;
}

/**
 * Returns the event and the index of the note within `event.notes`. Throws if
 * the event is a rest or the note id is not present.
 */
export function findNoteIndex(
  score: Score,
  locator: EventLocator,
  noteId: string,
): { event: NoteEvent; index: number } {
  const event = findEvent(score, locator);
  const notes = event.notes;
  if (!notes || notes.length === 0) {
    throw new PatchTargetMissing(`Event "${locator.eventId}" has no notes (cannot target note "${noteId}")`);
  }
  const index = notes.findIndex((n) => n.id === noteId);
  if (index === -1) {
    throw new PatchTargetMissing(`Note "${noteId}" not found in event "${locator.eventId}"`);
  }
  return { event, index };
}

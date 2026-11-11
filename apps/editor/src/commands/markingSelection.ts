/**
 * Markings that are selectable and deletable in their own right.
 *
 * These mutation primitives leave their owning notes intact. Selection
 * classification and batching belong to the deletion operation registry.
 */

import type { Score, SequenceContent } from "@viritura/core";
import { globalCaesuraMeasure } from "./caesura";
import { isAccidentalId, removeAccidental } from "./accidentalCommands";
import { isArticulationId, removeArticulation } from "./articulationDeletion";
import {
  getEventAtLocation,
  getEventAncestorId,
  resolveEventLocation,
  resolveGraceLocation,
} from "../score/ElementPath";

const CAESURA_SUFFIX = "/caesura";
const NOTE_MARKING_SUFFIX = /\/n(\d+)\/(slideIn|slideOut)$/;

function isNoteMarkingId(elementId: string): boolean {
  return NOTE_MARKING_SUFFIX.test(elementId);
}

function noteMarkingEvent(score: Score, eventId: string): SequenceContent | null | undefined {
  const grace = resolveGraceLocation(eventId, score);
  if (!grace) {
    const location = resolveEventLocation(eventId, score);
    return location ? getEventAtLocation(score, location) : null;
  }
  const sequence = score.parts[grace.partIndex]?.measures[grace.measureIndex]?.sequences[grace.sequenceIndex];
  const container = grace.tupletIndex === undefined ? undefined : sequence?.content[grace.tupletIndex];
  const content = container?.type === "tuplet" || container?.type === "tremolo" ? container.content : sequence?.content;
  const graceContainer = content?.[grace.graceContainerIndex];
  return graceContainer?.type === "grace" ? graceContainer.content[grace.graceNoteIndex] : null;
}

function removeNoteMarking(score: Score, elementId: string): Score | null {
  const match = NOTE_MARKING_SUFFIX.exec(elementId);
  if (!match) return null;
  const event = noteMarkingEvent(score, elementId.slice(0, match.index));
  const note = event?.type === "event" ? event.notes?.[Number(match[1])] : undefined;
  const key = match[2] === "slideIn" ? "slideIn" : "slideOut";
  if (!note?.markings?.[key]) return null;
  delete note.markings[key];
  if (Object.keys(note.markings).length === 0) delete note.markings;
  return score;
}

function isCaesuraId(elementId: string): boolean {
  return elementId.endsWith(CAESURA_SUFFIX);
}

export function removeCaesura(score: Score, elementId: string): Score | null {
  if (!isCaesuraId(elementId)) return null;
  const globalIndex = globalCaesuraMeasure(elementId);
  if (globalIndex !== null) {
    const measure = score.global.measures[globalIndex];
    if (!measure?.caesura) return null;
    delete measure.caesura;
    return score;
  }
  const location = resolveEventLocation(getEventAncestorId(elementId), score);
  const event = location ? getEventAtLocation(score, location) : null;
  if (!event || event.type !== "event" || !event.markings?.caesura) return null;
  delete event.markings.caesura;
  if (Object.keys(event.markings).length === 0) delete event.markings;
  return score;
}

/**
 * Remove the marking named by `elementId`, mutating `score` in place. Returns
 * null when the id isn't a marking, or names one the event doesn't carry.
 */
function removeMarking(score: Score, elementId: string): Score | null {
  if (isAccidentalId(elementId)) return removeAccidental(score, elementId);
  if (isArticulationId(elementId)) return removeArticulation(score, elementId);
  if (isCaesuraId(elementId)) return removeCaesura(score, elementId);
  if (isNoteMarkingId(elementId)) return removeNoteMarking(score, elementId);
  return null;
}

/**
 * Apply `removeMarking` to every id, mutating `score` in place. Returns true
 * when at least one marking was actually removed.
 *
 * Order doesn't matter here: markings are addressed by name within their
 * event, not by an index that earlier removals could shift.
 */
export function removeMarkings(score: Score, elementIds: readonly string[]): boolean {
  let removed = false;
  for (const id of elementIds) {
    if (removeMarking(score, id)) removed = true;
  }
  return removed;
}

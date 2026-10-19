/**
 * Markings that are selectable and deletable in their own right.
 *
 * An accidental or an articulation is drawn as part of its event but is its
 * own object: deleting one must leave the note alone. Every delete path has to
 * split these out of a selection before handing the rest to the event-level
 * primitives, which replace whole events with rests.
 *
 * Grouping them here keeps that partition in one place. The alternative — each
 * delete path testing both id shapes itself — is how the multi-selection path
 * came to blank notes while the single-selection path did the right thing.
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

export function isNoteMarkingId(elementId: string): boolean {
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

export function removeNoteMarking(score: Score, elementId: string): Score | null {
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

export function isCaesuraId(elementId: string): boolean {
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

/** True when `elementId` names a marking that deletes on its own. */
function isMarkingId(elementId: string): boolean {
  return (
    isAccidentalId(elementId) || isArticulationId(elementId) || isCaesuraId(elementId) || isNoteMarkingId(elementId)
  );
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
 * Split selected ids into markings and everything else, so a mixed selection
 * can delete each kind with the right primitive.
 */
export function partitionMarkingIds(elementIds: readonly string[]): {
  markingIds: string[];
  eventIds: string[];
} {
  const markingIds: string[] = [];
  const eventIds: string[] = [];
  for (const id of elementIds) {
    if (isMarkingId(id)) markingIds.push(id);
    else eventIds.push(id);
  }
  return { markingIds, eventIds };
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

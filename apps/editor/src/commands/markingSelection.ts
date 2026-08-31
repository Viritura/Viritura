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

import type { Score } from "@viritura/core";
import { isAccidentalId, removeAccidental } from "./accidentalCommands";
import { isArticulationId, removeArticulation } from "./articulationDeletion";

/** True when `elementId` names a marking that deletes on its own. */
function isMarkingId(elementId: string): boolean {
  return isAccidentalId(elementId) || isArticulationId(elementId);
}

/**
 * Remove the marking named by `elementId`, mutating `score` in place. Returns
 * null when the id isn't a marking, or names one the event doesn't carry.
 */
function removeMarking(score: Score, elementId: string): Score | null {
  if (isAccidentalId(elementId)) return removeAccidental(score, elementId);
  if (isArticulationId(elementId)) return removeArticulation(score, elementId);
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

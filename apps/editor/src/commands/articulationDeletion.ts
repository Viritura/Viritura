/**
 * Deleting an articulation.
 *
 * Unlike an accidental, an articulation carries no pitch — removing it is
 * exactly removing the marking. The only subtlety is combo ligatures: one
 * glyph standing for two markings (accent + staccato, say). There is no way to
 * click half a ligature, so deleting it removes both constituents.
 */

import type { Markings, Score } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";
import { getEventAtLocation, resolveEventLocation } from "../score/ElementPath";
import { markingsForArticulationName } from "../score/articulationNames";

/** Matches the trailing `/art-{name}` segment the engine tags articulations with. */
const ARTICULATION_SUFFIX = /\/art-([A-Za-z.]+)$/;

/** True when `elementId` names an articulation rather than any other element. */
export function isArticulationId(elementId: string): boolean {
  return ARTICULATION_SUFFIX.test(elementId);
}

interface ArticulationLocation {
  location: EventLocation;
  /** Marking fields the clicked glyph draws. More than one for a ligature. */
  markings: (keyof Markings)[];
}

/** Resolve an articulation element id to the markings its glyph draws. */
function resolveArticulationLocation(elementId: string, score: Score): ArticulationLocation | null {
  const match = elementId.match(ARTICULATION_SUFFIX);
  if (!match) return null;
  const markings = markingsForArticulationName(match[1]!);
  if (markings.length === 0) return null;
  const location = resolveEventLocation(elementId.slice(0, match.index), score);
  if (!location) return null;
  return { location, markings };
}

/**
 * Remove the articulation named by `elementId`, mutating `score` in place and
 * returning it. Returns null when the id doesn't resolve to an event actually
 * carrying that marking, so the caller can fall through to its other delete
 * paths.
 */
export function removeArticulation(score: Score, elementId: string): Score | null {
  const resolved = resolveArticulationLocation(elementId, score);
  if (!resolved) return null;

  const event = getEventAtLocation(score, resolved.location);
  if (!event || event.type !== "event") return null;
  const markings = event.markings;
  if (!markings) return null;

  let removed = false;
  for (const field of resolved.markings) {
    if (markings[field] === undefined) continue;
    delete markings[field];
    removed = true;
  }
  if (!removed) return null;

  // An empty markings bag is noise in the document and in the MNX output.
  if (Object.keys(markings).length === 0) delete event.markings;
  return score;
}

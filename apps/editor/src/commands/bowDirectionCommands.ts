import type { BowDirection, Score } from "@viritura/core";
import { getEventAtLocation } from "../score/ElementPath";

export function setBowDirection(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
  direction?: BowDirection["direction"],
  tupletIndex?: number,
  contentPath?: number[],
): Score | null {
  const event = getEventAtLocation(score, {
    partIndex,
    measureIndex,
    sequenceIndex,
    eventIndex,
    tupletIndex,
    contentPath,
  });
  if (event?.type !== "event" || !event.notes?.length) return null;
  if (!event.markings) event.markings = {};

  if (direction === undefined) {
    delete event.markings.bowDirection;
  } else {
    event.markings.bowDirection = { ...event.markings.bowDirection, direction };
  }

  if (Object.keys(event.markings).length === 0) delete event.markings;
  return score;
}

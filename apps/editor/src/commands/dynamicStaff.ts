import type { Score } from "@viritura/core";
import { getEventAtLocation, type EventLocation } from "../score/ElementPath";

/**
 * Staff scope for a newly-authored dynamic at an event.
 *
 * Single-staff parts keep the field absent (the compact MNX default). On a
 * multi-staff part, the event's cross-staff override wins, followed by its
 * sequence staff; otherwise the top staff is staff 1.
 */
export function dynamicStaffAtLocation(score: Score, location: EventLocation): number | undefined {
  const part = score.parts[location.partIndex];
  if (!part || (part.staves ?? 1) <= 1) return undefined;
  const sequence = part.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  const event = getEventAtLocation(score, location);
  const eventStaff = event && "staff" in event ? event.staff : undefined;
  return eventStaff ?? sequence?.staff ?? 1;
}

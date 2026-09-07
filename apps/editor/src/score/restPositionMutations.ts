import type { NoteEvent, Score } from "@viritura/core";
import { produce } from "./scoreClone";

export interface RestPositionTarget {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
}

function selectedEvent(score: Score, target: RestPositionTarget): NoteEvent | null {
  const sequence = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
  if (!sequence) return null;

  if (target.graceContainerIndex !== undefined) {
    const grace = sequence.content[target.graceContainerIndex];
    const event = grace?.type === "grace" ? grace.content[target.eventIndex] : undefined;
    return event?.type === "event" ? event : null;
  }

  if (target.tupletIndex !== undefined) {
    const container = sequence.content[target.tupletIndex];
    const event =
      container?.type === "tuplet" || container?.type === "tremolo" ? container.content[target.eventIndex] : undefined;
    return event?.type === "event" ? event : null;
  }

  const event = sequence.content[target.eventIndex];
  return event?.type === "event" ? event : null;
}

export function setRestStaffPositionInScore(
  score: Score,
  target: RestPositionTarget,
  staffPosition: number | null,
): Score {
  const event = selectedEvent(score, target);
  if (!event?.rest || (staffPosition !== null && !Number.isInteger(staffPosition))) return score;
  if (
    event.rest.staffPosition === staffPosition ||
    (staffPosition === null && event.rest.staffPosition === undefined)
  ) {
    return score;
  }

  return produce(score, (draft) => {
    const rest = selectedEvent(draft, target)!.rest!;
    if (staffPosition === null) delete rest.staffPosition;
    else rest.staffPosition = staffPosition;
  });
}

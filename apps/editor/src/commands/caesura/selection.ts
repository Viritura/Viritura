import type { Score } from "@viritura/core";
import { eventEndBeatPosition } from "../../app/timedAnnotationPosition";
import { planSelectionWriteback } from "../../score/condensedWriteback";
import type { EventLocation } from "../../score/ElementPath";
import type { Selection } from "../../store/selectionStore";
import { dynamicStaffAtLocation } from "../dynamicStaff";

function includesStaff(score: Score, selection: Selection, location: EventLocation): boolean {
  if (selection.kind !== "measure") return true;
  const first = {
    part: selection.startPartIndex,
    staff: (selection.startLocalStaffIndex ?? 0) + 1,
  };
  const last = {
    part: selection.endPartIndex,
    staff: (selection.endLocalStaffIndex ?? 0) + 1,
  };
  const compare = (a: typeof first, b: typeof first) => a.part - b.part || a.staff - b.staff;
  const [start, end] = compare(first, last) <= 0 ? [first, last] : [last, first];
  const target = { part: location.partIndex, staff: dynamicStaffAtLocation(score, location) ?? 1 };
  return compare(target, start) >= 0 && compare(target, end) <= 0;
}

/** A caesura terminates the selected passage once per staff, not once per note or voice. */
export function selectedLocalCaesuraTargets(
  score: Score,
  selection: Selection,
  selectedScoreIndex?: number,
): EventLocation[] {
  const plan = planSelectionWriteback(score, selection, selectedScoreIndex);
  const targets = new Map<string, { location: EventLocation; beat: number }>();
  for (const event of plan.events) {
    if (!includesStaff(score, selection, event.visualEvent)) continue;
    for (const location of event.sourceEvents) {
      const sequence =
        score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
      if (!sequence) continue;
      const beat = eventEndBeatPosition(sequence, location);
      const staff = dynamicStaffAtLocation(score, location) ?? 1;
      const key = `${location.partIndex}/${staff}`;
      const previous = targets.get(key);
      if (
        !previous ||
        location.measureIndex > previous.location.measureIndex ||
        (location.measureIndex === previous.location.measureIndex && beat > previous.beat)
      ) {
        targets.set(key, { location, beat });
      }
    }
  }
  return [...targets.values()].map(({ location }) => location);
}

import { isRest, type Duration, type SequenceContent } from "@viritura/core";
import { beatPositionToFraction } from "../app/timedAnnotationPosition";
import { decomposeDuration, durationToBeats, generateEventId, sequenceContentBeats } from "../commands/noteCommands";

export function splitSequenceAtBeat(content: SequenceContent[], targetBeat: number): void {
  let onset = 0;
  for (let index = 0; index < content.length; index++) {
    const item = content[index]!;
    const duration = sequenceContentBeats(item);
    const end = onset + duration;
    if (targetBeat <= onset + 1e-9 || targetBeat >= end - 1e-9) {
      onset = end;
      continue;
    }
    const before = targetBeat - onset;
    const after = end - targetBeat;
    const roundoff = Number.EPSILON * (index + 2) * (Math.abs(end) + Math.abs(targetBeat));
    if (item.type === "space") {
      content.splice(
        index,
        1,
        { type: "space", duration: exactWholeFraction(before, roundoff) },
        { type: "space", duration: exactWholeFraction(after, roundoff) },
      );
      return;
    }
    if (item.type !== "event" || !isRest(item)) {
      throw new Error("The destination voice must have a rhythmic boundary at the MuseScore voice offset.");
    }
    const rests = [...exactRestDurations(before, roundoff), ...exactRestDurations(after, roundoff)].map(
      (durationValue) => ({
        type: "event" as const,
        id: generateEventId(),
        duration: durationValue,
        rest: {},
      }),
    );
    content.splice(index, 1, ...rests);
    return;
  }
}

export function ensureSequencePosition(content: SequenceContent[], targetBeat: number): void {
  const existingBeats = content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  if (existingBeats >= targetBeat - 1e-9) return;
  const roundoff = Number.EPSILON * (content.length + 1) * (Math.abs(existingBeats) + Math.abs(targetBeat));
  content.push({
    type: "space",
    duration: exactWholeFraction(targetBeat - existingBeats, roundoff),
  });
}

function assertExactBeats(expected: number, actual: number, roundoff: number): void {
  // Permit accumulated summation/subtraction error, not the converter's rhythmic approximation.
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(expected)) * 8 + roundoff;
  if (!Number.isFinite(expected) || expected <= 0 || Math.abs(actual - expected) > tolerance) {
    throw new Error("Cannot represent the destination voice offset exactly.");
  }
}

function exactWholeFraction(quarterBeats: number, roundoff: number): [number, number] {
  const fraction = beatPositionToFraction(quarterBeats);
  if (!fraction.every(Number.isSafeInteger) || fraction[0] <= 0 || fraction[1] <= 0) {
    throw new Error("Cannot represent the destination voice offset exactly.");
  }
  assertExactBeats(quarterBeats, (fraction[0] / fraction[1]) * 4, roundoff);
  return fraction;
}

function exactRestDurations(beats: number, roundoff: number): Duration[] {
  const durations = decomposeDuration(beats);
  assertExactBeats(
    beats,
    durations.reduce((sum, duration) => sum + durationToBeats(duration), 0),
    roundoff,
  );
  return durations;
}

import type { Sequence } from "@viritura/core";
import { durationToBeats, sequenceContentBeats } from "../commands/noteCommands";

export interface TimedAnnotationTarget {
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
}

export function eventBeatPosition(sequence: Sequence, target: TimedAnnotationTarget): number {
  const topLevelIndex = target.tupletIndex ?? target.graceContainerIndex ?? target.eventIndex;
  let beat = sequence.content.slice(0, topLevelIndex).reduce((sum, content) => sum + sequenceContentBeats(content), 0);
  if (target.tupletIndex === undefined) return beat;

  const container = sequence.content[target.tupletIndex];
  if (container?.type !== "tuplet") return beat;
  const outerBeats = container.outer.multiple * durationToBeats(container.outer.duration);
  const innerBeats = container.inner.multiple * durationToBeats(container.inner.duration);
  const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
  beat += container.content
    .slice(0, target.eventIndex)
    .reduce((sum, content) => sum + sequenceContentBeats(content) * scale, 0);
  return beat;
}

export function beatPositionToFraction(beat: number): [number, number] {
  const wholeNotes = beat / 4;
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Math.abs(wholeNotes);
  for (let denominator = 1; denominator <= 4096; denominator++) {
    const numerator = Math.round(wholeNotes * denominator);
    const error = Math.abs(wholeNotes - numerator / denominator);
    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
      if (error < 1e-9) break;
    }
  }
  return [bestNumerator, bestDenominator];
}

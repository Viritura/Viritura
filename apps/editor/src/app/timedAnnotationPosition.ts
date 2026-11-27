import type { Sequence, SequenceContent } from "@viritura/core";
import { durationToBeats, sequenceContentBeats } from "../commands/noteCommands";

export interface TimedAnnotationTarget {
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
}

/** Walk a content path, scaling each enclosing tuplet or tremolo. */
export function sequenceContentBoundary(
  content: readonly SequenceContent[],
  path: readonly number[],
  end = false,
): number {
  const index = path[0]!;
  const before = content.slice(0, index).reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  const item = content[index];
  if (!item) return before;
  if (path.length === 1) return before + (end ? sequenceContentBeats(item) : 0);
  if (item.type !== "tuplet" && item.type !== "tremolo") return before;
  const innerTime = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
  const outerTime = sequenceContentBeats(item);
  return (
    before + sequenceContentBoundary(item.content, path.slice(1), end) * (innerTime > 0 ? outerTime / innerTime : 1)
  );
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

export function eventEndBeatPosition(sequence: Sequence, target: TimedAnnotationTarget): number {
  const start = eventBeatPosition(sequence, target);
  const containerIndex = target.tupletIndex ?? target.graceContainerIndex;
  if (containerIndex === undefined) {
    const event = sequence.content[target.eventIndex];
    return start + (event ? sequenceContentBeats(event) : 0);
  }

  const container = sequence.content[containerIndex];
  if (container?.type !== "tuplet") return start;
  const event = container.content[target.eventIndex];
  if (!event) return start;
  const outerBeats = container.outer.multiple * durationToBeats(container.outer.duration);
  const innerBeats = container.inner.multiple * durationToBeats(container.inner.duration);
  const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
  return start + sequenceContentBeats(event) * scale;
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

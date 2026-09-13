import type { RhythmicPosition, Score, TimeSignature } from "@viritura/core";
import type { TextPopoverNavigationCommand } from "@viritura/ui";
import {
  buildNavigationIndex,
  findNextInVoice,
  findNextMeasure,
  findPrevInVoice,
  findPrevMeasure,
} from "../navigation/NavigationIndex";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { ChordSymbolPopoverState } from "../store/overlayStore";
import { resolveChordSymbolTarget } from "./useAppKeyboardWiring";
import { beatPositionToFraction, eventBeatPosition } from "./timedAnnotationPosition";

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function fraction(numerator: number, denominator: number): RhythmicPosition {
  const divisor = gcd(numerator, denominator);
  return { fraction: [numerator / divisor, denominator / divisor] };
}

function addPosition(position: RhythmicPosition, numerator: number, denominator: number): RhythmicPosition {
  const [currentNumerator, currentDenominator] = position.fraction;
  return fraction(currentNumerator * denominator + numerator * currentDenominator, currentDenominator * denominator);
}

function comparePosition(left: RhythmicPosition, right: RhythmicPosition): number {
  return left.fraction[0] * right.fraction[1] - right.fraction[0] * left.fraction[1];
}

function activeTime(score: Score, measureIndex: number): TimeSignature {
  for (let index = measureIndex; index >= 0; index--) {
    const time = score.global.measures[index]?.time;
    if (time) return time;
  }
  return { count: 4, unit: 4 };
}

function beatStep(time: TimeSignature): [number, number] {
  return time.unit >= 8 && time.count > 3 && time.count % 3 === 0 ? [3, time.unit] : [1, time.unit];
}

function measureEnd(score: Score, target: ChordSymbolPopoverState, time: TimeSignature): RhythmicPosition {
  const measure = score.parts[target.partIndex]?.measures[target.measureIndex];
  const contentBeats = Math.max(
    0,
    ...(measure?.sequences.map((sequence) =>
      sequence.content.reduce((total, content) => total + sequenceContentBeats(content), 0),
    ) ?? []),
  );
  return contentBeats > 0 ? { fraction: beatPositionToFraction(contentBeats) } : fraction(time.count, time.unit);
}

function currentPosition(score: Score, current: ChordSymbolPopoverState): RhythmicPosition | null {
  if (current.rhythmicPosition) return current.rhythmicPosition;
  const sequence = score.parts[current.partIndex]?.measures[current.measureIndex]?.sequences[current.sequenceIndex];
  if (!sequence) return null;
  return { fraction: beatPositionToFraction(eventBeatPosition(sequence, current)) };
}

function eventNavigationTarget(
  score: Score,
  current: ChordSymbolPopoverState,
  nextId: string | undefined,
  selectedScoreIndex: number,
): ChordSymbolPopoverState | null {
  if (!nextId) return null;
  return resolveChordSymbolTarget(
    score,
    { kind: "single", elementId: nextId, elementType: "event" },
    selectedScoreIndex,
    current.position,
  );
}

function reanchorWithinMeasure(
  score: Score,
  current: ChordSymbolPopoverState,
  position: RhythmicPosition,
  selectedScoreIndex: number,
): ChordSymbolPopoverState {
  const nav = buildNavigationIndex(score);
  const beat = (position.fraction[0] / position.fraction[1]) * 4;
  const entry = nav.entries
    .filter(
      (candidate) =>
        (candidate.elementType === "event" || candidate.elementType === "rest") &&
        candidate.partIndex === current.partIndex &&
        candidate.measureIndex === current.measureIndex &&
        candidate.sequenceIndex === current.sequenceIndex &&
        candidate.sortKey <= beat,
    )
    .at(-1);
  const anchored = eventNavigationTarget(score, current, entry?.elementId, selectedScoreIndex);
  return { ...(anchored ?? current), rhythmicPosition: position };
}

function navigateBeat(
  score: Score,
  current: ChordSymbolPopoverState,
  direction: 1 | -1,
  selectedScoreIndex: number,
): ChordSymbolPopoverState | null {
  const position = currentPosition(score, current);
  if (!position || !current.anchorElementId) return null;
  const time = activeTime(score, current.measureIndex);
  const [stepNumerator, stepDenominator] = beatStep(time);
  const stepped = addPosition(position, direction * stepNumerator, stepDenominator);
  const end = measureEnd(score, current, time);
  if (comparePosition(stepped, fraction(0, 1)) >= 0 && comparePosition(stepped, end) < 0) {
    return reanchorWithinMeasure(score, current, stepped, selectedScoreIndex);
  }

  const nav = buildNavigationIndex(score);
  const adjacentId =
    direction > 0 ? findNextMeasure(nav, current.anchorElementId) : findPrevMeasure(nav, current.anchorElementId);
  const adjacent = eventNavigationTarget(score, current, adjacentId, selectedScoreIndex);
  if (!adjacent) return null;
  if (direction > 0) return { ...adjacent, rhythmicPosition: fraction(0, 1) };
  const previousTime = activeTime(score, adjacent.measureIndex);
  const previousEnd = measureEnd(score, adjacent, previousTime);
  const [previousStepNumerator, previousStepDenominator] = beatStep(previousTime);
  return {
    ...adjacent,
    rhythmicPosition: addPosition(previousEnd, -previousStepNumerator, previousStepDenominator),
  };
}

export function navigateChordSymbolInput(
  score: Score,
  current: ChordSymbolPopoverState,
  command: TextPopoverNavigationCommand,
  selectedScoreIndex: number,
): ChordSymbolPopoverState | null {
  if (!current.anchorElementId) return null;
  if (command === "nextBeat" || command === "previousBeat") {
    return navigateBeat(score, current, command === "nextBeat" ? 1 : -1, selectedScoreIndex);
  }
  const nav = buildNavigationIndex(score);
  const nextId =
    command === "next"
      ? findNextInVoice(nav, current.anchorElementId)
      : command === "previous"
        ? findPrevInVoice(nav, current.anchorElementId)
        : command === "nextMeasure"
          ? findNextMeasure(nav, current.anchorElementId)
          : findPrevMeasure(nav, current.anchorElementId);
  return eventNavigationTarget(score, current, nextId, selectedScoreIndex);
}

import type { Score } from "@viritura/core";

interface RestSpan {
  start: number;
  end: number;
}

function multimeasureRestSpans(score: Score, scoreIndex: number): RestSpan[] {
  const scoreDefinition = score.scores?.[scoreIndex];
  if (!scoreDefinition?.multimeasureRests?.length) return [];
  const indexById = new Map<string, number>();
  score.global.measures.forEach((measure, index) => {
    if (measure.id) indexById.set(measure.id, index);
  });
  return scoreDefinition.multimeasureRests.flatMap((rest) => {
    const start = indexById.get(rest.start);
    if (start === undefined || rest.duration <= 0) return [];
    return [{ start, end: Math.min(start + rest.duration, score.global.measures.length) }];
  });
}

/** Resolve the measure that starts after the visible barline the user clicked. */
export function breakTargetAfterBarline(
  score: Score,
  scoreIndex: number,
  measureIndex: number,
  visibleMeasureIndices?: readonly number[],
): string | undefined {
  const nextVisibleIndex = visibleMeasureIndices
    ? [...new Set(visibleMeasureIndices)].sort((left, right) => left - right).find((index) => index > measureIndex)
    : undefined;
  const rest = multimeasureRestSpans(score, scoreIndex).find(
    (span) => measureIndex >= span.start && measureIndex < span.end,
  );
  const targetIndex = nextVisibleIndex ?? rest?.end ?? measureIndex + 1;
  return score.global.measures[targetIndex]?.id;
}

/** Resolve the visible measure whose right barline should display a break marker. */
export function markerMeasureBeforeBreak(
  score: Score,
  scoreIndex: number,
  breakMeasureIndex: number,
  visibleMeasureIndices?: readonly number[],
): number {
  const previousVisibleIndex = visibleMeasureIndices
    ? [...new Set(visibleMeasureIndices)]
        .filter((index) => index < breakMeasureIndex)
        .sort((left, right) => right - left)[0]
    : undefined;
  if (previousVisibleIndex !== undefined) return previousVisibleIndex;
  const precedingIndex = breakMeasureIndex - 1;
  const rest = multimeasureRestSpans(score, scoreIndex).find(
    (span) => precedingIndex >= span.start && precedingIndex < span.end,
  );
  return rest?.start ?? precedingIndex;
}

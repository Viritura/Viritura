import type { Score } from "@viritura/core";

export interface MeasureReference {
  measureIndex: number;
  measureOrdinal: number;
  measureNumber: number;
  measureId: string | null;
}

export function measureReference(score: Score, index: number): MeasureReference {
  const measure = score.global.measures[index];
  if (!measure) throw new Error(`Unknown measure index: ${String(index)}.`);
  return {
    measureIndex: index,
    measureOrdinal: index + 1,
    measureNumber: measure.number ?? index + 1,
    measureId: measure.id ?? null,
  };
}

export function resolveMeasureRange(
  score: Score,
  input: Record<string, unknown>,
  defaultSpan: number,
  maxSpan?: number,
): { startMeasure: number; endMeasure: number } {
  const count = score.global.measures.length;
  if (count === 0) throw new Error("The score has no measures.");
  const startMeasure = readBoundary(score, input.startMeasure, input.startMeasureId, 1, "start");
  const endMeasure = readBoundary(
    score,
    input.endMeasure,
    input.endMeasureId,
    Math.min(startMeasure + defaultSpan - 1, count),
    "end",
  );
  if (endMeasure < startMeasure) throw new Error("endMeasure must be greater than or equal to startMeasure.");
  if (maxSpan !== undefined && endMeasure - startMeasure + 1 > maxSpan) {
    throw new Error(`A measure query may return at most ${String(maxSpan)} measures.`);
  }
  return { startMeasure, endMeasure };
}

function readBoundary(score: Score, ordinal: unknown, id: unknown, fallback: number, label: string): number {
  if (ordinal !== undefined && id !== undefined) {
    throw new Error(`Provide either ${label}Measure or ${label}MeasureId, not both.`);
  }
  if (id !== undefined) {
    if (typeof id !== "string" || id.length === 0) throw new Error(`${label}MeasureId must be a non-empty string.`);
    const matches = score.global.measures.flatMap((measure, index) => (measure.id === id ? [index + 1] : []));
    if (matches.length !== 1) throw new Error(`Measure ID ${id} is missing or not unique.`);
    return matches[0]!;
  }
  if (ordinal === undefined) return fallback;
  if (
    typeof ordinal !== "number" ||
    !Number.isInteger(ordinal) ||
    ordinal < 1 ||
    ordinal > score.global.measures.length
  ) {
    throw new Error(`Measure ordinals must be integers from 1 to ${String(score.global.measures.length)}.`);
  }
  return ordinal;
}

import { setMeasureRepeat, type Score } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionScope } from "../store/selectionUtils";

export interface MeasureRepeatCommandResult {
  score: Score;
  error?: string;
}

interface MeasureRepeatLocation {
  partIndex: number;
  measureIndex: number;
  elementId: string;
}

function parseMeasureRepeatElementId(elementId: string): MeasureRepeatLocation | null {
  const match = elementId.match(/^p(\d+)\/m(\d+)\/measurerepeat$/);
  if (!match) return null;
  return {
    partIndex: Number.parseInt(match[1]!, 10),
    measureIndex: Number.parseInt(match[2]!, 10),
    elementId,
  };
}

/** Resolve the repeat signs represented by a single, Shift-range, or Ctrl multi-selection. */
export function measureRepeatElementIdsForSelection(score: Score, selection: SelectionState): string[] {
  if (selection.kind === "single") {
    const location = parseMeasureRepeatElementId(selection.elementId);
    return location && score.parts[location.partIndex]?.measures[location.measureIndex]?.measureRepeat
      ? [location.elementId]
      : [];
  }
  if (selection.kind === "multi") {
    return selection.elementIds.filter((elementId) => {
      const location = parseMeasureRepeatElementId(elementId);
      return Boolean(location && score.parts[location.partIndex]?.measures[location.measureIndex]?.measureRepeat);
    });
  }
  if (selection.kind !== "range") return [];

  const start = parseMeasureRepeatElementId(selection.startElementId);
  const end = parseMeasureRepeatElementId(selection.endElementId);
  if (!start || !end) return [];
  const startPart = Math.min(start.partIndex, end.partIndex);
  const endPart = Math.max(start.partIndex, end.partIndex);
  const startMeasure = Math.min(start.measureIndex, end.measureIndex);
  const endMeasure = Math.max(start.measureIndex, end.measureIndex);
  const ids: string[] = [];
  for (let partIndex = startPart; partIndex <= endPart; partIndex++) {
    for (let measureIndex = startMeasure; measureIndex <= endMeasure; measureIndex++) {
      if (score.parts[partIndex]?.measures[measureIndex]?.measureRepeat) {
        ids.push(`p${partIndex}/m${measureIndex}/measurerepeat`);
      }
    }
  }
  return ids;
}

/** Delete every repeat sign represented by a repeat-only selection. */
export function deleteMeasureRepeatsForSelection(score: Score, selection: SelectionState): Score | null {
  const elementIds = measureRepeatElementIdsForSelection(score, selection);
  if (elementIds.length === 0) return null;
  let nextScore = score;
  for (const elementId of elementIds) {
    nextScore = deleteMeasureRepeatByElementId(nextScore, elementId) ?? nextScore;
  }
  return nextScore;
}

/** Remove the measure repeat addressed by `p{part}/m{measure}/measurerepeat`. */
export function deleteMeasureRepeatByElementId(score: Score, elementId: string): Score | null {
  const location = parseMeasureRepeatElementId(elementId);
  if (!location || !score.parts[location.partIndex]?.measures[location.measureIndex]?.measureRepeat) return null;
  return setMeasureRepeat(score, location.partIndex, location.measureIndex, null);
}

/**
 * Fill the selected measure range with measure-repeat blocks for every selected
 * part. Each block start receives an explicit MNX counter beginning at 2.
 * Applying the same complete pattern again removes it.
 */
export function toggleMeasureRepeatForSelection(
  score: Score,
  selection: SelectionState,
  number: 1 | 2 | 4,
): MeasureRepeatCommandResult {
  const scope = resolveSelectionScope(selection, score);
  if (!scope) {
    return { score, error: "Select the first measure for the measure repeat." };
  }

  const rangeLength = scope.endMeasure - scope.startMeasure + 1;
  if (rangeLength % number !== 0) {
    return {
      score,
      error: `Select a measure range divisible by ${number}; the current range contains ${rangeLength} ${rangeLength === 1 ? "measure" : "measures"}.`,
    };
  }
  if (scope.startMeasure < number) {
    return {
      score,
      error: `A ${number}-bar measure repeat needs ${number} preceding source ${number === 1 ? "measure" : "measures"}.`,
    };
  }
  if (scope.endMeasure >= score.global.measures.length) {
    return {
      score,
      error: "The selected measure-repeat range extends beyond the score.",
    };
  }

  const blockStarts = Array.from(
    { length: rangeLength / number },
    (_, blockIndex) => scope.startMeasure + blockIndex * number,
  );
  const partIndices = Array.from(
    { length: scope.endPart - scope.startPart + 1 },
    (_, offset) => scope.startPart + offset,
  );
  if (
    partIndices.some((partIndex) => {
      const part = score.parts[partIndex];
      return !part || scope.endMeasure >= part.measures.length;
    })
  ) {
    return { score, error: "The selected part does not contain the complete measure-repeat range." };
  }

  const remove = partIndices.every((partIndex) =>
    blockStarts.every((measureIndex, blockIndex) => {
      const repeat = score.parts[partIndex]!.measures[measureIndex]!.measureRepeat;
      return repeat?.number === number && repeat.counter?.count === blockIndex + 2;
    }),
  );
  let nextScore = score;
  for (const partIndex of partIndices) {
    for (let measureIndex = scope.startMeasure; measureIndex <= scope.endMeasure; measureIndex++) {
      if (nextScore.parts[partIndex]!.measures[measureIndex]!.measureRepeat) {
        nextScore = setMeasureRepeat(nextScore, partIndex, measureIndex, null);
      }
    }
    if (!remove) {
      for (const [blockIndex, measureIndex] of blockStarts.entries()) {
        nextScore = setMeasureRepeat(nextScore, partIndex, measureIndex, {
          number,
          counter: { count: blockIndex + 2 },
        });
      }
    }
  }
  return { score: nextScore };
}

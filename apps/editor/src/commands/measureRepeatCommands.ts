import { setMeasureRepeat, type Score } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionScope } from "../store/selectionUtils";

export interface MeasureRepeatCommandResult {
  score: Score;
  error?: string;
}

/**
 * Toggle a measure-repeat sign at the first selected measure for every selected
 * part. Applying the same span again removes it; choosing a different span
 * replaces it.
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

  const measureIndex = scope.startMeasure;
  if (measureIndex < number) {
    return {
      score,
      error: `A ${number}-bar measure repeat needs ${number} preceding source ${number === 1 ? "measure" : "measures"}.`,
    };
  }
  if (measureIndex + number > score.global.measures.length) {
    return {
      score,
      error: `A ${number}-bar measure repeat needs ${number} available ${number === 1 ? "measure" : "measures"} from the insertion point.`,
    };
  }

  const partIndices = Array.from(
    { length: scope.endPart - scope.startPart + 1 },
    (_, offset) => scope.startPart + offset,
  );
  if (
    partIndices.some((partIndex) => {
      const part = score.parts[partIndex];
      return !part || measureIndex + number > part.measures.length;
    })
  ) {
    return { score, error: "The selected part does not contain the complete measure-repeat range." };
  }

  const remove = partIndices.every(
    (partIndex) => score.parts[partIndex]!.measures[measureIndex]!.measureRepeat?.number === number,
  );
  let nextScore = score;
  for (const partIndex of partIndices) {
    nextScore = setMeasureRepeat(nextScore, partIndex, measureIndex, remove ? null : { number });
  }
  return { score: nextScore };
}

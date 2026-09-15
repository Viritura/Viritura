import { useCallback, useMemo, useState } from "react";
import type { Score } from "@viritura/core";
import { setMeasureNumber, type NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import type { Selection } from "../../store/selectionStore";

interface UseMeasureNumberInspectorArgs {
  score: Score | null;
  selection: Selection;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

function selectedMeasureIndex(selection: Selection, target: NotationSelectionTarget | null): number | null {
  if (selection.kind === "measure") {
    return selection.startMeasure === selection.endMeasure ? selection.startMeasure : null;
  }
  return target &&
    selection.kind === "single" &&
    (selection.elementType === "barline" || selection.elementType === "measure-number")
    ? target.measureIndex
    : null;
}

export function useMeasureNumberInspector({ score, selection, target, updateScore }: UseMeasureNumberInspectorArgs) {
  const measureIndex = selectedMeasureIndex(selection, target);
  const value = measureIndex === null ? undefined : score?.global.measures[measureIndex]?.number;
  const [error, setError] = useState<string | null>(null);

  const setValue = useCallback(
    (nextValue: string) => {
      if (!score || measureIndex === null) return;
      const result = setMeasureNumber(
        score,
        {
          elementId: `m${measureIndex}/mnum`,
          elementType: "measure-number",
          partIndex: 0,
          measureIndex,
        },
        nextValue,
      );
      if (!result.ok || !result.score) {
        setError(result.error ?? "Could not update the measure number.");
        return;
      }
      setError(null);
      updateScore(result.score);
    },
    [measureIndex, score, updateScore],
  );

  return useMemo(
    () => ({
      isAvailable: measureIndex !== null && score !== null,
      measureIndex,
      value,
      error,
      setValue,
    }),
    [error, measureIndex, score, setValue, value],
  );
}

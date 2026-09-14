import { useCallback } from "react";
import { setTimeSignature, type Score, type TimeSignature } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";

export type TimeSignatureDisplayValue = "numeric" | "common" | "cut" | "senzaMisura" | "note";

interface UseTimeSignatureInspectorArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  isTimeSignatureSelected: boolean;
  updateScore: (score: Score) => void;
}

export function useTimeSignatureInspector({
  score,
  target,
  isTimeSignatureSelected,
  updateScore,
}: UseTimeSignatureInspectorArgs) {
  const measureIndex = isTimeSignatureSelected && target ? target.measureIndex : null;
  const time = measureIndex === null ? undefined : score?.global.measures[measureIndex]?.time;

  const setDisplay = useCallback(
    (display: TimeSignatureDisplayValue) => {
      if (!score || measureIndex === null || !time) return;
      const next: TimeSignature = { ...time };
      if (display === "numeric") delete next.display;
      else next.display = display;
      updateScore(setTimeSignature(score, measureIndex, next));
    },
    [measureIndex, score, time, updateScore],
  );

  const remove = useCallback(() => {
    if (!score || measureIndex === null || !time) return;
    updateScore(setTimeSignature(score, measureIndex, null));
  }, [measureIndex, score, time, updateScore]);

  return {
    isAvailable: time !== undefined,
    time,
    display: (time?.display ?? "numeric") as TimeSignatureDisplayValue,
    setDisplay,
    remove,
  };
}

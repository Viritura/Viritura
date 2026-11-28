import { useCallback } from "react";
import { appendEmptyMeasures, insertEmptyMeasures } from "../score/ScoreMutations";
import {
  transposeNotes,
  type TransposeParams,
  CHROMATIC_INTERVALS,
  DIATONIC_INTERVALS,
} from "../commands/transposeCommands";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";
import type { Score } from "@viritura/core";

interface UseScoreEditingActionsOptions {
  store: DocumentStore;
  selection: SelectionState;
  updateScore: (next: Score) => void;
}

export function useScoreEditingActions({ store, selection, updateScore }: UseScoreEditingActionsOptions) {
  const handleAddMeasures = useCallback(
    (count = 1, atIndex?: number) => {
      const { score } = store.getState();
      if (!score || count < 1) return;
      const newScore =
        atIndex === undefined ? appendEmptyMeasures(score, count) : insertEmptyMeasures(score, atIndex, count);
      if (newScore !== score) updateScore(newScore);
    },
    [store, updateScore],
  );

  const handleTransposeDialog = useCallback(
    (params: TransposeParams) => {
      const { score } = store.getState();
      if (!score || selection.kind === "none") return;

      const intervals = params.mode === "chromatic" ? CHROMATIC_INTERVALS : DIATONIC_INTERVALS;
      const baseAmount = intervals[params.interval] ?? 0;
      const amount = params.direction === "up" ? baseAmount : -baseAmount;

      // Transpose every event covered by the selection (single note, multi,
      // range, or measure rectangle), grounded in the canonical selection
      // primitive so behaviour is consistent across selection kinds.
      const locations = resolveSelectionEvents(selection, score);
      if (locations.length === 0) return;

      const newScore = transposeNotes(score, locations, params.mode, amount);
      updateScore(newScore);
    },
    [store, selection, updateScore],
  );

  return {
    handleAddMeasures,
    handleTransposeDialog,
  };
}

import { useCallback } from "react";
import { produce } from "../score/scoreClone";
import { appendEmptyMeasures, insertEmptyMeasures } from "../score/ScoreMutations";
import {
  transposeNotes,
  type TransposeParams,
  CHROMATIC_INTERVALS,
  DIATONIC_INTERVALS,
} from "../commands/transposeCommands";
import type { PageSetup } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";
import type { Score } from "@viritura/core";

interface UseScoreEditingActionsOptions {
  store: DocumentStore;
  selection: SelectionState;
  selectedScoreIndex: number;
  pageSetupTargetIndex: number | null;
  updateScore: (next: Score) => void;
}

export function useScoreEditingActions({
  store,
  selection,
  selectedScoreIndex,
  pageSetupTargetIndex,
  updateScore,
}: UseScoreEditingActionsOptions) {
  const handleApplyPageSetup = useCallback(
    (setup: PageSetup) => {
      const { score } = store.getState();
      if (!score) return;
      const updated = produce(score, (draft) => {
        const scoreIdx = pageSetupTargetIndex ?? selectedScoreIndex;
        if (draft.scores && draft.scores[scoreIdx]) {
          draft.scores[scoreIdx].pageSetup = setup;
        }
      });
      updateScore(updated);
    },
    [store, selectedScoreIndex, pageSetupTargetIndex, updateScore],
  );

  const handleResetPageSetup = useCallback(() => {
    const { score } = store.getState();
    if (!score) return;
    const updated = produce(score, (draft) => {
      const scoreIdx = pageSetupTargetIndex ?? selectedScoreIndex;
      if (draft.scores && draft.scores[scoreIdx]) {
        delete draft.scores[scoreIdx].pageSetup;
      }
    });
    updateScore(updated);
  }, [store, selectedScoreIndex, pageSetupTargetIndex, updateScore]);

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
    handleApplyPageSetup,
    handleResetPageSetup,
    handleAddMeasures,
    handleTransposeDialog,
  };
}

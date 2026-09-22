import { useCallback } from "react";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { applyDistribution, type DistributionMode } from "../score/chordDistribution";
import { chordLineNoteIds, type ChordEdge } from "../store/chordNoteSelection";
import { useSelectionActions, type SelectionState } from "../store/selectionStore";
import { useViewStateStore } from "../store/viewStateStore";
import type { useDocumentStoreApi } from "../store/DocumentContext";

interface UseChordDistributionActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  selection: SelectionState;
  updateScore: (next: Score) => void;
}

export interface ChordDistributionActions {
  /** Fan the selected chords out across this staff and the staves below it. */
  handleExplodeSelection: () => void;
  /** Collapse the selected staves onto the topmost one. */
  handleReduceSelection: () => void;
  /** Select the top notehead of every selected chord. */
  handleSelectChordTopNote: () => void;
  /** Select the bottom notehead of every selected chord. */
  handleSelectChordBottomNote: () => void;
  canDistribute: boolean;
}

const EMPTY_SELECTION_MESSAGE = "Select the notes to distribute first.";

export function useChordDistributionActions({
  store,
  selection,
  updateScore,
}: UseChordDistributionActionsArgs): ChordDistributionActions {
  const { selectElements } = useSelectionActions();
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);

  const distribute = useCallback(
    (mode: DistributionMode) => {
      const { score } = store.getState();
      if (!score || selection.kind === "none") {
        toast.info(EMPTY_SELECTION_MESSAGE);
        return;
      }
      const result = applyDistribution(score, selection, mode, selectedScoreIndex);
      if (!result) {
        toast.info(EMPTY_SELECTION_MESSAGE);
        return;
      }
      if (result.changed) updateScore(result.score);
      for (const warning of result.warnings) toast.warning(warning);
    },
    [store, selection, updateScore, selectedScoreIndex],
  );

  const selectChordLine = useCallback(
    (edge: ChordEdge) => {
      const { score } = store.getState();
      if (!score || selection.kind === "none") return;
      const ids = chordLineNoteIds(score, selection, edge);
      if (ids.length === 0) {
        toast.info("The selection has no chord notes to isolate.");
        return;
      }
      selectElements(ids);
    },
    [store, selection, selectElements],
  );

  return {
    handleExplodeSelection: useCallback(() => distribute("explode"), [distribute]),
    handleReduceSelection: useCallback(() => distribute("reduce"), [distribute]),
    handleSelectChordTopNote: useCallback(() => selectChordLine("top"), [selectChordLine]),
    handleSelectChordBottomNote: useCallback(() => selectChordLine("bottom"), [selectChordLine]),
    canDistribute: selection.kind !== "none",
  };
}

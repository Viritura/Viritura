import { useCallback, useEffect, useState } from "react";
import { produce } from "immer";
import { useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";
import type { Score } from "@viritura/core";

export interface UseConcertPitchResult {
  useWritten: boolean;
  handleConcertPitchToggle: (written: boolean) => void;
}

/**
 * Local mirror of `score.scores[index].useWritten` with an updater that
 * persists the change through the document store. Shared by Write/Engrave
 * surfaces so the concert/written toggle behaves identically wherever the
 * status bar exposes it.
 */
export function useConcertPitch(
  selectedScoreIndex: number,
  updateScore: (score: Score) => void,
): UseConcertPitchResult {
  const store = useDocumentStoreApi();
  const [useWritten, setUseWritten] = useState(false);
  const scoreUseWritten = useDocumentStore((s) => s.score?.scores?.[selectedScoreIndex]?.useWritten);

  useEffect(() => {
    // Must also reset to false when undefined (score has no useWritten field,
    // or switching to a score/loading a document that doesn't set it) — otherwise
    // a stale `true` from a previously viewed score (or the prior document)
    // lingers in the status bar while the newly-shown score renders concert pitch.
    setUseWritten(!!scoreUseWritten);
  }, [scoreUseWritten]);

  const handleConcertPitchToggle = useCallback(
    (written: boolean) => {
      setUseWritten(written);
      const { score } = store.getState();
      if (!score) return;
      const newScore = produce(score, (draft) => {
        if (draft.scores && draft.scores[selectedScoreIndex]) {
          draft.scores[selectedScoreIndex]!.useWritten = written;
        }
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, selectedScoreIndex, updateScore],
  );

  return { useWritten, handleConcertPitchToggle };
}

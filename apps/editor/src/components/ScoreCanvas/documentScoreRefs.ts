import { useEffect, useRef, type MutableRefObject } from "react";
import type { Score } from "@viritura/core";
import type { DocumentStore } from "../../store/documentStore";

function partIdsForScore(score: Score | null): string[] {
  return (score?.parts ?? []).map((part) => part.id ?? "");
}

/**
 * Mirror the document store's live working score into refs used by canvas
 * lifecycle callbacks. The published `score` selector intentionally lags until
 * layout paint, so these refs must not be overwritten by unrelated React
 * rerenders while a worker layout is still in flight.
 */
export function useDocumentScoreRefs(
  documentStore: DocumentStore,
  publishedScore: Score | null,
): {
  docScoreRef: MutableRefObject<Score | null>;
  partIdByIndexRef: MutableRefObject<readonly string[]>;
} {
  const initialScore = documentStore.getState().workingScore ?? publishedScore;
  const docScoreRef = useRef<Score | null>(initialScore);
  const partIdByIndexRef = useRef<readonly string[]>(partIdsForScore(initialScore));

  useEffect(() => {
    const sync = (score: Score | null) => {
      docScoreRef.current = score;
      partIdByIndexRef.current = partIdsForScore(score);
    };
    sync(documentStore.getState().workingScore ?? publishedScore);
    return documentStore.subscribe((state) => sync(state.workingScore ?? state.score));
  }, [documentStore, publishedScore]);

  return { docScoreRef, partIdByIndexRef };
}

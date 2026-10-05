import { useEffect } from "react";
import { create } from "zustand";
import type { Score } from "@viritura/core";

/** Final page count of the last paged layout, tied to the exact score it laid out. */
interface RenderedPageCount {
  score: Score;
  scoreIndex: number;
  pageCount: number;
}

interface RenderedPagesState {
  rendered: RenderedPageCount | null;
  publish: (rendered: RenderedPageCount) => void;
}

export const useRenderedPagesStore = create<RenderedPagesState>((set) => ({
  rendered: null,
  publish: (rendered) => set({ rendered }),
}));

/**
 * Page count for `score`'s view `scoreIndex`, or `null` when no paged layout of
 * this exact score is known (for example after an edit made in Horizon mode).
 */
function renderedPageCountFor(
  rendered: RenderedPageCount | null,
  score: Score | null,
  scoreIndex: number,
): number | null {
  if (!rendered || !score || rendered.score !== score || rendered.scoreIndex !== scoreIndex) return null;
  return rendered.pageCount;
}

export function useRenderedPageCount(score: Score | null, scoreIndex: number): number | null {
  const rendered = useRenderedPagesStore((state) => state.rendered);
  return renderedPageCountFor(rendered, score, scoreIndex);
}

/**
 * Publish the final page count after each paged display-list commit so page
 * locators beyond the last page can be listed as unplaced. Horizon layouts have
 * no pages and publish nothing.
 */
export function usePublishRenderedPageCount(
  displayListRef: { readonly current: { pages?: readonly unknown[] } | null },
  displayListVersion: number,
  score: Score | null,
  scoreIndex: number,
  paged: boolean,
): void {
  const publish = useRenderedPagesStore((state) => state.publish);
  useEffect(() => {
    const pageCount = displayListRef.current?.pages?.length ?? 0;
    if (!paged || !score || pageCount === 0) return;
    publish({ score, scoreIndex, pageCount });
  }, [displayListRef, displayListVersion, score, scoreIndex, paged, publish]);
}

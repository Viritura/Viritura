import { useMemo } from "react";
import type { Score } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import type { ClipboardFragment } from "../../clipboard/ClipboardFragment";
import type { ClipboardSourceRef } from "../../store/clipboardHistoryStore";
import { partHasNotes, filterSilentParts, sliceSnapshot, splitForElision } from "./sliceSnapshot";

export type RenderPlan =
  | { mode: "snippet"; staves: number; hiddenStaves: number }
  | { mode: "snapshot-contig"; score: Score; staves: number; hiddenStaves: number }
  | {
      mode: "snapshot-elided";
      head: Score;
      tail: Score;
      elidedCount: number;
      staves: number;
      hiddenStaves: number;
    };

interface UseRenderPlanArgs {
  fragment: ClipboardFragment;
  source: ClipboardSourceRef | undefined;
  snapshotMnxJson: string | undefined;
  maxContig: number;
  headTail: number;
}

/**
 * Decide which render path the preview should use, and (for snapshot paths)
 * compute the sliced/elided scores once per snapshot+source change.
 */
export function useRenderPlan({
  fragment,
  source,
  snapshotMnxJson,
  maxContig,
  headTail,
}: UseRenderPlanArgs): RenderPlan {
  return useMemo<RenderPlan>(() => {
    const snippetStaves = computeSnippetStaves(fragment);

    if (!source || !snapshotMnxJson) {
      return { mode: "snippet", staves: snippetStaves, hiddenStaves: 0 };
    }
    try {
      return planFromSnapshot(snapshotMnxJson, source, maxContig, headTail, snippetStaves);
    } catch {
      return { mode: "snippet", staves: snippetStaves, hiddenStaves: 0 };
    }
  }, [fragment, source, snapshotMnxJson, maxContig, headTail]);
}

function computeSnippetStaves(fragment: ClipboardFragment): number {
  if (!fragment.tracks || fragment.tracks.length <= 1) return 1;
  return new Set(fragment.tracks.map((t) => t.partOffset)).size;
}

function planFromSnapshot(
  snapshotMnxJson: string,
  source: ClipboardSourceRef,
  maxContig: number,
  headTail: number,
  snippetStaves: number,
): RenderPlan {
  const parsed = parseMnx(JSON.parse(snapshotMnxJson));
  const rawSliced = sliceSnapshot(parsed, source.partIndices, source.startMeasure, source.endMeasure);
  const totalParts = rawSliced.parts.length;
  const elided = splitForElision(
    rawSliced,
    rawSliced.parts.map((_, i) => i),
    source.startMeasure,
    source.endMeasure,
    maxContig,
    headTail,
  );

  if (elided) return planElided(elided, totalParts, snippetStaves);

  const { score: sliced, hiddenCount: hiddenStaves } = filterSilentParts(rawSliced);
  const staves = sliced.parts.length || snippetStaves;
  return { mode: "snapshot-contig", score: sliced, staves, hiddenStaves };
}

function planElided(
  elided: { head: Score; tail: Score; elidedCount: number },
  totalParts: number,
  snippetStaves: number,
): RenderPlan {
  // Filter on the UNION of parts with notes in either visible slice so head
  // and tail stay vertically aligned (same staves across both panels).
  const keepIdx = new Set<number>();
  for (let i = 0; i < elided.head.parts.length; i++) {
    if (partHasNotes(elided.head.parts[i]!)) keepIdx.add(i);
  }
  for (let i = 0; i < elided.tail.parts.length; i++) {
    if (partHasNotes(elided.tail.parts[i]!)) keepIdx.add(i);
  }
  let filteredHead = elided.head;
  let filteredTail = elided.tail;
  let hiddenStaves = totalParts - keepIdx.size;
  if (keepIdx.size === 0) {
    hiddenStaves = 0;
  } else if (hiddenStaves > 0) {
    const indices = [...keepIdx].sort((a, b) => a - b);
    filteredHead = { ...elided.head, parts: indices.map((i) => elided.head.parts[i]!) };
    filteredTail = { ...elided.tail, parts: indices.map((i) => elided.tail.parts[i]!) };
  }
  const staves = (hiddenStaves > 0 ? keepIdx.size : totalParts) || snippetStaves;
  return {
    mode: "snapshot-elided",
    head: filteredHead,
    tail: filteredTail,
    elidedCount: elided.elidedCount,
    staves,
    hiddenStaves,
  };
}

import type { Score, SequenceContent, NoteEvent, Clef } from "@viritura/core";

function sequenceHasNotes(items: SequenceContent[]): boolean {
  for (const item of items) {
    if (item.type === "event") {
      const ev = item as NoteEvent;
      if (!ev.rest && ev.notes && ev.notes.length > 0) return true;
    } else if (item.type === "grace") {
      for (const ev of item.content) {
        if (ev.notes && ev.notes.length > 0) return true;
      }
    } else if (item.type === "tuplet") {
      if (sequenceHasNotes(item.content)) return true;
    }
  }
  return false;
}

/** True if `part` has at least one pitched (non-rest) note across all sliced measures. */
export function partHasNotes(part: Score["parts"][number]): boolean {
  for (const measure of part.measures) {
    for (const seq of measure.sequences) {
      if (sequenceHasNotes(seq.content)) return true;
    }
  }
  return false;
}

/**
 * Drop parts containing only rests in the slice. If filtering would leave
 * zero parts, returns the original score (so something still renders).
 */
export function filterSilentParts(score: Score): { score: Score; hiddenCount: number } {
  const kept = score.parts.filter(partHasNotes);
  if (kept.length === 0) return { score, hiddenCount: 0 };
  const hiddenCount = score.parts.length - kept.length;
  if (hiddenCount === 0) return { score, hiddenCount: 0 };
  return { score: { ...score, parts: kept }, hiddenCount };
}

/**
 * Slice a Score down to a contiguous part range × measure range. Preserves
 * everything inside (clefs, dynamics, lyrics, transposition, etc.) but
 * replaces global.measures and each Part.measures with the trimmed slice.
 * Also forwards the leading clef/key/time signature onto the first
 * surviving measure so the rendered slice reads correctly.
 */
export function sliceSnapshot(source: Score, partIndices: number[], startMeasure: number, endMeasure: number): Score {
  const startM = Math.max(0, startMeasure);
  const endM = Math.min(endMeasure, source.global.measures.length - 1);

  let carryTime = source.global.measures[0]?.time;
  let carryKey = source.global.measures[0]?.key;
  for (let m = 0; m <= startM && m < source.global.measures.length; m++) {
    const gm = source.global.measures[m];
    if (gm?.time) carryTime = gm.time;
    if (gm?.key) carryKey = gm.key;
  }
  const slicedGlobalMeasures = source.global.measures.slice(startM, endM + 1).map((gm, idx) =>
    idx === 0
      ? {
          ...gm,
          ...(carryTime ? { time: gm.time ?? carryTime } : {}),
          ...(carryKey ? { key: gm.key ?? carryKey } : {}),
        }
      : gm,
  );

  const slicedParts = partIndices
    .map((pi) => source.parts[pi])
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((part) => {
      let carryClef: Clef | undefined;
      for (let m = 0; m <= startM && m < part.measures.length; m++) {
        const c = part.measures[m]?.clefs?.[0]?.clef;
        if (c) carryClef = c;
      }
      const slicedMeasures = part.measures.slice(startM, endM + 1).map((pm, idx) => {
        if (idx !== 0) return pm;
        if (pm.clefs && pm.clefs.length > 0) return pm;
        if (!carryClef) return pm;
        return { ...pm, clefs: [{ clef: carryClef }] };
      });
      return { ...part, measures: slicedMeasures };
    });

  return {
    ...source,
    global: { ...source.global, measures: slicedGlobalMeasures },
    parts: slicedParts,
    layouts: undefined,
    scores: undefined,
  };
}

/**
 * For "long range" copies, split the snapshot slice into a head + tail pair
 * so the preview can render only the first/last measures with a visual gap.
 * Returns null when the slice is short enough to render contiguously.
 */
export function splitForElision(
  sliced: Score,
  partIndices: number[],
  startMeasure: number,
  endMeasure: number,
  maxContiguous: number,
  headTail: number,
): { head: Score; tail: Score; elidedCount: number } | null {
  const totalMeasures = endMeasure - startMeasure + 1;
  if (totalMeasures <= maxContiguous) return null;

  const headStart = startMeasure;
  const headEnd = startMeasure + headTail - 1;
  const tailStart = endMeasure - headTail + 1;
  const tailEnd = endMeasure;
  // Re-slice using offset arithmetic against `sliced` (already trimmed and
  // context-carried-forward from index 0).
  const headSlice = sliceSnapshot(
    sliced,
    partIndices.map((_, i) => i),
    headStart - startMeasure,
    headEnd - startMeasure,
  );
  const tailSlice = sliceSnapshot(
    sliced,
    partIndices.map((_, i) => i),
    tailStart - startMeasure,
    tailEnd - startMeasure,
  );
  return { head: headSlice, tail: tailSlice, elidedCount: totalMeasures - headTail * 2 };
}

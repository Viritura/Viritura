/**
 * Derive the inclusive measure-index range affected by a batch of patches.
 *
 * Most `ScorePatch` variants address content inside a specific global measure
 * (`measureIndex` reachable via `locator.sequencePath`, `measurePath`, or
 * `sequencePath`). When callers run a post-edit pass that's logically
 * per-measure (e.g. beat-count repair), they can scope the pass to this range
 * instead of walking the whole score — a major speedup on long scores where
 * each edit only touches a tiny slice.
 *
 * Returns `null` when `patches` is empty OR when the batch contains a
 * structural patch (insert/remove measures, add/remove part, score-level
 * edits) whose effect can't be expressed as a bounded measure range; callers
 * fall back to their whole-score behaviour in that case.
 */
import type { ScorePatch } from "./types";

export function patchAffectedMeasures(patches: readonly ScorePatch[]): { start: number; end: number } | null {
  if (patches.length === 0) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const p of patches) {
    const mi = patchMeasureIndex(p);
    // A structural patch has no bounded range; discard range info for the batch.
    if (mi === null) return null;
    if (mi < start) start = mi;
    if (mi > end) end = mi;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

/**
 * The single global measure index a patch touches, or `null` when the patch is
 * structural (insert/remove measures, add/remove part, score-level edits) and
 * therefore can't be expressed as a bounded measure range.
 */
function patchMeasureIndex(p: ScorePatch): number | null {
  switch (p.kind) {
    case "setNotePitch":
    case "setNoteField":
    case "addNoteToEvent":
    case "removeNoteFromEvent":
      return p.locator.sequencePath.measureIndex;
    case "setEventField":
      // A slur's `target` is an event id that may live in a LATER measure
      // (or an earlier one, for a backward-authored slur). This function
      // has no Score to resolve that id to a measure index, and slur
      // rendering spans the whole staff-system between the two endpoints —
      // so a narrow single-measure range would leave the target measure's
      // cached segment stale. Bail to `null` (whole-score fallback) rather
      // than risk an incomplete dirty range.
      if (p.update.field === "slurs") return null;
      return p.locator.sequencePath.measureIndex;
    case "setEventMarking":
      return p.locator.sequencePath.measureIndex;
    case "setMeasureDynamicGroup":
    case "setMeasureArpeggio":
    case "setPartMeasureField":
      return p.measurePath.measureIndex;
    case "spliceSequenceContent":
    case "setSequenceContent":
      return p.sequencePath.measureIndex;
    case "setGlobalMeasureField":
      return p.measureIndex;
    case "insertMeasures":
    case "removeMeasures":
    case "addPart":
    case "removePart":
    case "setPartField":
    case "setScoreMetadata":
    case "setScoreExtension":
      return null;
  }
}

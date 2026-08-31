import type { MnxEvent, MnxGlobalMeasure, MnxPart, MnxPartMeasure } from "../types";

/** Minimum run length worth collapsing — a single empty measure is just shown
 *  as a whole-measure rest, not a multimeasure rest. */
const MIN_RUN = 2;

/** A measure is "empty" for multimeasure-rest purposes when every sequence
 *  contains only rests (and invisible spaces) — no notes, grace notes, tuplets
 *  or tremolos. A measure with no sequences is treated as empty. */
function isRestOnlyMeasure(m: MnxPartMeasure | undefined): boolean {
  if (!m || !m.sequences || m.sequences.length === 0) return true;
  for (const seq of m.sequences) {
    for (const item of seq.content) {
      // Invisible spacer — does not count as content.
      if ((item as { type?: string }).type === "space") continue;
      // Only a plain event that is a rest (no notes) keeps the measure empty.
      const ev = item as MnxEvent;
      const isRestEvent = ev.type === undefined && ev.rest !== undefined && (!ev.notes || ev.notes.length === 0);
      if (!isRestEvent) return false;
    }
  }
  return true;
}

/** Does global measure `gm` introduce an event that must interrupt a
 *  multimeasure rest (standard engraving practice breaks an MMR at meter/key
 *  changes, tempo changes, rehearsal marks, repeats, voltas and jumps)? */
function globalBreaksBefore(gm: MnxGlobalMeasure | undefined): boolean {
  if (!gm) return true;
  if (gm.time || gm.key || gm.ending || gm.repeatStart || gm.segno || gm.fine || gm.jump) return true;
  if (gm.tempos && gm.tempos.length > 0) return true;
  const ext = (gm as unknown as { _x?: { viritura?: Record<string, unknown> } })._x?.viritura;
  if (ext && (ext["rehearsalMark"] !== undefined || ext["coda"] !== undefined)) return true;
  return false;
}

/** Does global measure `gm` carry a right-hand event that must interrupt a
 *  multimeasure rest continuing into the next measure (end repeat, section or
 *  final barline)? */
function globalBreaksAfter(gm: MnxGlobalMeasure | undefined): boolean {
  if (!gm) return false;
  if (gm.repeatEnd) return true;
  // A non-regular right barline (double/final/dashed/etc.) ends the run.
  if (gm.barline && gm.barline.type !== "regular") return true;
  return false;
}

/**
 * Compute multimeasure-rest ranges for an individual player part: runs of
 * consecutive empty measures collapsed into a single rest. Runs break at meter,
 * key, tempo, rehearsal, repeat, volta and jump boundaries, and at mid-part
 * clef changes, matching standard part engraving. Only runs of `MIN_RUN`+
 * measures are emitted.
 */
export function computeMultimeasureRests(
  part: MnxPart,
  globalMeasures: MnxGlobalMeasure[],
): { start: string; duration: number }[] {
  const ranges: { start: string; duration: number }[] = [];
  const count = Math.min(part.measures.length, globalMeasures.length);

  let runStart = -1; // index of the first measure in the current empty run
  const flush = (endExclusive: number): void => {
    if (runStart < 0) return;
    const duration = endExclusive - runStart;
    const startId = globalMeasures[runStart]?.id;
    if (duration >= MIN_RUN && startId) {
      ranges.push({ start: startId, duration });
    }
    runStart = -1;
  };

  for (let i = 0; i < count; i++) {
    const empty = isRestOnlyMeasure(part.measures[i]);
    if (!empty) {
      flush(i);
      continue;
    }
    // A mid-part clef change (any clef on a measure other than the first) must
    // interrupt the run so the new clef is shown.
    const clefBreak = i > 0 && (part.measures[i]?.clefs?.length ?? 0) > 0;
    const mustBreakBefore =
      runStart >= 0 && (clefBreak || globalBreaksBefore(globalMeasures[i]) || globalBreaksAfter(globalMeasures[i - 1]));
    if (mustBreakBefore) flush(i);
    if (runStart < 0) runStart = i;
  }
  flush(count);

  return ranges;
}

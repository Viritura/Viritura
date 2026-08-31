/**
 * Measure beat-count validation and repair.
 *
 * Ensures every metered measure in every voice has exactly the right number of
 * beats for the active time signature. Senza misura measures are exempt.
 * Handles two repair cases:
 *
 * 1. **Too few beats**: Pads with rests at the end to fill the measure.
 * 2. **Too many beats**: Truncates trailing content (removes from the end,
 *    preferring to remove rests before notes).
 *
 * This runs:
 * - On import (to fix malformed MNX files)
 * - After every score update (as a safety net against editor bugs)
 */

import type { Score, Sequence, NoteEvent, Duration } from "@viritura/core";
import { measureBeats, isRest } from "@viritura/core";
import { sequenceContentBeats, decomposeDuration, generateEventId } from "./noteCommands";

// ═══════════════════════════════════════════
// Beat count analysis
// ═══════════════════════════════════════════

export interface MeasureBeatInfo {
  partIndex: number;
  measureIndex: number;
  voiceIndex: number;
  expectedBeats: number;
  actualBeats: number;
  difference: number; // positive = overfull, negative = underfull
}

/**
 * Analyze all measures for beat count issues.
 * Returns an array of issues (empty = all measures are correct).
 */
export function analyzeBeatCounts(score: Score): MeasureBeatInfo[] {
  const issues: MeasureBeatInfo[] = [];
  let activeTime = { count: 4, unit: 4 };

  for (let m = 0; m < score.global.measures.length; m++) {
    const gm = score.global.measures[m];
    if (gm?.time) activeTime = gm.time;
    const expected = measureBeats(activeTime);
    const isPickupMeasure = m === 0 && gm?.number === 0;
    const isSenzaMisura = gm?.time?.display === "senzaMisura";

    // Senza misura has no fixed rhythmic capacity. Its count/unit remains the
    // active meter for following measures, but written content must not be
    // padded or truncated in the declaring measure.
    if (isSenzaMisura) continue;

    for (let p = 0; p < score.parts.length; p++) {
      const part = score.parts[p];
      if (!part) continue;
      const pm = part.measures[m];
      if (!pm) continue;

      for (let s = 0; s < pm.sequences.length; s++) {
        const seq = pm.sequences[s];
        if (!seq) continue;

        // Skip fullMeasure sequences — they're placeholders
        if (seq.fullMeasure) continue;

        const actual = computeSequenceBeats(seq);
        const diff = actual - expected;

        // Pickup (anacrusis) measures are intentionally short — Viritura
        // convention is `measure[0].number === 0`. Do not flag underfull
        // content as an issue (matches Rust reconcile_score behavior).
        if (isPickupMeasure && diff < 0) continue;

        if (Math.abs(diff) > 1e-9) {
          issues.push({
            partIndex: p,
            measureIndex: m,
            voiceIndex: s,
            expectedBeats: expected,
            actualBeats: actual,
            difference: diff,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Analyze beat counts for a specific range of measures only.
 * Much faster than analyzeBeatCounts for localized edits in large scores.
 */
export function analyzeBeatCountsInRange(score: Score, startMeasure: number, endMeasure: number): MeasureBeatInfo[] {
  const issues: MeasureBeatInfo[] = [];

  // Resolve the active time signature at the start of the range
  let activeTime = { count: 4, unit: 4 };
  for (let m = 0; m <= Math.min(startMeasure, score.global.measures.length - 1); m++) {
    const gm = score.global.measures[m];
    if (gm?.time) activeTime = gm.time;
  }

  for (let m = startMeasure; m <= Math.min(endMeasure, score.global.measures.length - 1); m++) {
    const gm = score.global.measures[m];
    if (gm?.time) activeTime = gm.time;
    const expected = measureBeats(activeTime);
    const isPickupMeasure = m === 0 && gm?.number === 0;
    const isSenzaMisura = gm?.time?.display === "senzaMisura";

    if (isSenzaMisura) continue;

    for (let p = 0; p < score.parts.length; p++) {
      const part = score.parts[p];
      if (!part) continue;
      const pm = part.measures[m];
      if (!pm) continue;

      for (let s = 0; s < pm.sequences.length; s++) {
        const seq = pm.sequences[s];
        if (!seq) continue;
        if (seq.fullMeasure) continue;

        const actual = computeSequenceBeats(seq);
        const diff = actual - expected;

        if (isPickupMeasure && diff < 0) continue;

        if (Math.abs(diff) > 1e-9) {
          issues.push({
            partIndex: p,
            measureIndex: m,
            voiceIndex: s,
            expectedBeats: expected,
            actualBeats: actual,
            difference: diff,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Compute the total beats in a sequence.
 */
function computeSequenceBeats(seq: Sequence): number {
  let total = 0;
  for (const item of seq.content) {
    total += sequenceContentBeats(item);
  }
  return total;
}

// ═══════════════════════════════════════════
// Repair
// ═══════════════════════════════════════════

function createRest(duration: Duration): NoteEvent {
  return {
    type: "event",
    id: generateEventId(),
    duration,
    rest: {},
  };
}

/**
 * Repair all measure beat count issues in-place.
 *
 * - Underfull measures: pads with rests at the end.
 * - Overfull measures: truncates from the end, preferring to remove rests,
 *   then shrinking/removing notes if necessary.
 *
 * @param measureRange Optional — if provided, only scan measures in
 *   [start, end] (inclusive). This is much faster for localized edits
 *   in large scores.
 *
 * Returns the number of measures repaired.
 */
export function repairBeatCounts(score: Score, measureRange?: { start: number; end: number }): number {
  const issues = measureRange
    ? analyzeBeatCountsInRange(score, measureRange.start, measureRange.end)
    : analyzeBeatCounts(score);
  let repaired = 0;

  for (const issue of issues) {
    const seq = score.parts[issue.partIndex]?.measures[issue.measureIndex]?.sequences[issue.voiceIndex];
    if (!seq) continue;

    if (issue.difference < -1e-9) {
      // Underfull: pad with rests
      const gap = -issue.difference;
      const restDurations = decomposeDuration(gap);
      for (const d of restDurations) {
        seq.content.push(createRest(d));
      }
      repaired++;
    } else if (issue.difference > 1e-9) {
      truncateOverfullSequence(seq, issue.difference);
      repaired++;
    }
  }

  return repaired;
}

/**
 * Truncate trailing events from `seq` to remove `excess` beats. Whole events
 * are removed first; the final remaining excess is absorbed by shrinking (or
 * rest-replacing) the last event.
 */
function truncateOverfullSequence(seq: Sequence, initialExcess: number): void {
  let excess = initialExcess;
  while (excess > 1e-9 && seq.content.length > 0) {
    const lastIdx = seq.content.length - 1;
    const last = seq.content[lastIdx]!;
    const lastBeats = sequenceContentBeats(last);

    if (lastBeats <= excess + 1e-9) {
      seq.content.splice(lastIdx, 1);
      excess -= lastBeats;
      continue;
    }

    const keepBeats = lastBeats - excess;
    const keepDurations = decomposeDuration(keepBeats);
    shrinkLastEvent(seq, lastIdx, last, keepDurations);
    excess = 0;
  }
}

/**
 * Replace or shrink `last` (the trailing event of `seq`) so it occupies
 * exactly `keepDurations` total beats. Notes are shortened to their first
 * keep-duration with rest fragments appended; rests and other content types
 * are replaced wholesale with rests.
 */
function shrinkLastEvent(
  seq: Sequence,
  lastIdx: number,
  last: Sequence["content"][number],
  keepDurations: Duration[],
): void {
  if (last.type !== "event" || isRest(last)) {
    seq.content.splice(lastIdx, 1, ...keepDurations.map((d) => createRest(d)));
    return;
  }
  if (keepDurations.length === 0) return;
  last.duration = keepDurations[0]!;
  // If decomposed into multiple durations, add tied fragments
  // (simplified: just use the first duration for the note)
  if (keepDurations.length > 1) {
    const extraRests = keepDurations.slice(1).map((d) => createRest(d));
    seq.content.splice(lastIdx + 1, 0, ...extraRests);
  }
}

/**
 * Validate and optionally repair a score's beat counts.
 * Returns the score (mutated if repairs were needed) and info about what was fixed.
 */
function _validateAndRepairScore(score: Score): {
  score: Score;
  issuesFound: number;
  issuesRepaired: number;
} {
  const issues = analyzeBeatCounts(score);
  if (issues.length === 0) {
    return { score, issuesFound: 0, issuesRepaired: 0 };
  }

  const repaired = repairBeatCounts(score);
  return {
    score,
    issuesFound: issues.length,
    issuesRepaired: repaired,
  };
}

/**
 * Repeat & jump expansion — converts a `GlobalMeasure[]` into a linear
 * sequence of measure indices that the MIDI generator can walk straight
 * through.
 *
 * Extracted from `timeline.ts` to keep that file under the max-lines budget.
 */

import type { GlobalMeasure, Score } from "@viritura/core";

interface MeasureOrderHints {
  toCodaMeasureIndex?: number;
}

/**
 * Expand repeats and jumps into a linear sequence of measure indices.
 *
 * Handles:
 * - Simple repeats (repeatStart / repeatEnd)
 * - Volta brackets (endings with numbers)
 * - Jump markers (D.S. al Fine, D.S. al Coda, D.C. al Coda)
 */
export function expandMeasureOrder(globalMeasures: readonly GlobalMeasure[], hints?: MeasureOrderHints): number[] {
  if (globalMeasures.length === 0) return [];

  // Phase 1: expand repeats with volta endings
  const order = expandRepeats(globalMeasures);

  // Phase 2: handle jumps (D.S./D.C.)
  return expandJumps(globalMeasures, order, hints?.toCodaMeasureIndex);
}

export function detectToCodaMeasureIndex(score: Pick<Score, "parts">): number {
  for (const part of score.parts) {
    for (let i = 0; i < part.measures.length; i++) {
      const expressions = part.measures[i]?.expressions;
      if (!expressions || expressions.length === 0) continue;
      if (expressions.some((expr) => /\bto\s*coda\b/i.test(expr.text))) {
        return i;
      }
    }
  }
  return -1;
}

/** A volta ending spanning measure indices [startIdx, endIdx], taken on the listed pass numbers. */
interface EndingInfo {
  startIdx: number;
  endIdx: number;
  numbers: number[];
}

/**
 * Append one repeat-pass to `order`, skipping measures that belong to a
 * volta ending whose `numbers` list doesn't include the current pass.
 * Extracted so the volta loop in `expandRepeats` doesn't exceed max-depth.
 */
function appendVoltaPass(
  order: number[],
  endings: readonly EndingInfo[],
  pass: number,
  startIdx: number,
  endIdx: number,
): void {
  for (let j = startIdx; j <= endIdx; j++) {
    const inEnding = endings.find((e) => j >= e.startIdx && j <= e.endIdx);
    if (inEnding && !inEnding.numbers.includes(pass)) continue;
    order.push(j);
  }
}

/**
 * Expand repeat markers and volta endings into a linear measure order.
 */
function expandRepeats(globalMeasures: readonly GlobalMeasure[]): number[] {
  const order: number[] = [];
  const len = globalMeasures.length;
  let i = 0;

  while (i < len) {
    const gm = globalMeasures[i]!;

    if (gm.repeatEnd) {
      const repeatTimes = gm.repeatEnd.times ?? 2;

      // Find the matching repeatStart (scan backwards from current)
      let repeatStartIdx = 0;
      for (let j = i; j >= 0; j--) {
        if (globalMeasures[j]!.repeatStart) {
          repeatStartIdx = j;
          break;
        }
      }

      // Remove measures already added from the repeat range
      // (they were added as regular measures before we knew about the repeat)
      while (order.length > 0 && order[order.length - 1]! >= repeatStartIdx && order[order.length - 1]! <= i) {
        order.pop();
      }

      // Collect volta endings in this repeat section
      const endings: EndingInfo[] = [];
      for (let j = repeatStartIdx; j <= i; j++) {
        const ending = globalMeasures[j]!.ending;
        if (ending) {
          endings.push({
            startIdx: j,
            endIdx: Math.min(j + ending.duration - 1, i),
            numbers: ending.numbers,
          });
        }
      }

      if (endings.length > 0) {
        for (let pass = 1; pass <= repeatTimes; pass++) {
          appendVoltaPass(order, endings, pass, repeatStartIdx, i);
        }
      } else {
        for (let pass = 0; pass < repeatTimes; pass++) {
          for (let j = repeatStartIdx; j <= i; j++) {
            order.push(j);
          }
        }
      }

      i++;
    } else {
      order.push(i);
      i++;
    }
  }

  return order;
}

function appendRange(order: number[], start: number, endInclusive: number): void {
  for (let measure = start; measure <= endInclusive; measure++) order.push(measure);
}

function appendAlCodaReplay(
  result: number[],
  replayStart: number,
  codaIdx: number,
  measureCount: number,
  toCodaMeasureIdx: number | undefined,
): void {
  const replayEnd =
    toCodaMeasureIdx !== undefined && toCodaMeasureIdx >= replayStart && toCodaMeasureIdx < codaIdx
      ? toCodaMeasureIdx
      : codaIdx - 1;
  appendRange(result, replayStart, replayEnd);
  appendRange(result, codaIdx, measureCount - 1);
}

/**
 * Process jump markers in the measure order.
 */
function expandJumps(
  globalMeasures: readonly GlobalMeasure[],
  initialOrder: readonly number[],
  toCodaMeasureIdx: number | undefined,
): number[] {
  let segnoIdx = -1;
  let fineIdx = -1;
  let codaIdx = -1;

  for (let m = 0; m < globalMeasures.length; m++) {
    const gm = globalMeasures[m]!;
    if (gm.segno) segnoIdx = m;
    if (gm.fine) fineIdx = m;
    if (gm.coda) codaIdx = m;
  }

  // Find the first jump in the expanded order
  let jumpOrderPos = -1;
  let jumpMeasureIdx = -1;
  for (let p = 0; p < initialOrder.length; p++) {
    const mi = initialOrder[p]!;
    if (globalMeasures[mi]!.jump) {
      jumpOrderPos = p;
      jumpMeasureIdx = mi;
      break;
    }
  }

  if (jumpOrderPos === -1) return [...initialOrder];

  const jump = globalMeasures[jumpMeasureIdx]!.jump!;
  const result = initialOrder.slice(0, jumpOrderPos + 1);

  switch (jump.type) {
    case "dsalfine":
      if (segnoIdx >= 0 && fineIdx >= 0) appendRange(result, segnoIdx, fineIdx);
      break;
    case "dsalcoda":
      if (segnoIdx >= 0 && codaIdx >= 0)
        appendAlCodaReplay(result, segnoIdx, codaIdx, globalMeasures.length, toCodaMeasureIdx);
      break;
    case "dcalcoda":
      if (codaIdx >= 0) appendAlCodaReplay(result, 0, codaIdx, globalMeasures.length, toCodaMeasureIdx);
      break;
    case "segno":
      if (segnoIdx >= 0) appendRange(result, segnoIdx, globalMeasures.length - 1);
      break;
  }

  return result;
}

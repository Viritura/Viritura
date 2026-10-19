/**
 * Repeat & jump expansion — converts a `GlobalMeasure[]` into a linear
 * sequence of measure indices that the MIDI generator can walk straight
 * through.
 *
 * Extracted from `timeline.ts` to keep that file under the max-lines budget.
 */

import type { GlobalMeasure, Score } from "@viritura/core";
import { playbackGlobalMeasures } from "./cadenzaTiming";
import { compileNavigation, NavigationError, type PlayedMeasureSpan } from "./navigation";

/**
 * Expand repeats and jumps into a linear sequence of measure indices.
 *
 * Handles:
 * - Simple repeats (repeatStart / repeatEnd)
 * - Volta brackets (endings with numbers)
 * - Jump markers (D.S. al Fine, D.S. al Coda, D.C. al Coda)
 */
export function expandMeasureOrder(globalMeasures: readonly GlobalMeasure[]): number[] {
  return expandPlaybackItinerary(globalMeasures).map((span) => span.measureIndex);
}

export function expandPlaybackItinerary(
  measures: readonly GlobalMeasure[],
  lengths?: readonly number[],
): PlayedMeasureSpan[] {
  let activeBeats = 4;
  const measureLengths =
    lengths ??
    measures.map((measure) => {
      if (measure.time) activeBeats = (measure.time.count * 4) / measure.time.unit;
      return activeBeats;
    });
  return compileNavigation(measures, expandRepeats(measures), measureLengths);
}

export function scorePlaybackItinerary(score: Score): PlayedMeasureSpan[] {
  const indices = score.global.measures.map((_, index) => index);
  const lengths = playbackGlobalMeasures(score, indices).map((measure) => {
    const time = measure.time;
    return time ? (time.count * 4) / time.unit : 4;
  });
  return expandPlaybackItinerary(score.global.measures, lengths);
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
      if (!Number.isInteger(repeatTimes) || repeatTimes < 1 || repeatTimes > 1000) {
        throw new NavigationError("Repeat count must be an integer between 1 and 1000", [
          `/global/measures/${i}/repeatEnd/times`,
        ]);
      }

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

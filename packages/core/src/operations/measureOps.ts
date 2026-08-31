/**
 * Measure operations — pure functions for adding, inserting, and deleting
 * measures in a Score. Each function returns a new Score (immutable).
 */

import type { Score } from "../model/score";
import type { GlobalMeasure, PartMeasure, RepeatStart, RepeatEnd, Ending, MeasureRepeat } from "../model/measure";
import type { Part } from "../model/part";
import type { TimeSignature } from "../model/time";
import type { KeySignature } from "../model/key";
import type { Barline } from "../model/barline";
import type { Clef, PositionedClef } from "../model/clef";
import { generateId, collectScoreIds } from "../id";

/**
 * Create a default empty PartMeasure with a single full-measure rest.
 */
function createEmptyPartMeasure(): PartMeasure {
  return {
    sequences: [
      {
        content: [],
        fullMeasure: { visualDuration: { base: "whole" } },
      },
    ],
  };
}

/**
 * Append a new empty measure at the end of the score.
 * The new measure inherits no time/key signature (uses whatever is active).
 */
export function appendMeasure(score: Score): Score {
  const usedIds = collectScoreIds(score);
  let id = generateId();
  while (usedIds.has(id)) id = generateId();
  const newGlobal: GlobalMeasure = { id };

  // If the current last measure has an explicit final barline, remove it
  // since it is no longer the last measure. The layout engine automatically
  // renders a final barline on the actual last measure.
  const oldMeasures = score.global.measures;
  const lastIdx = oldMeasures.length - 1;
  let updatedMeasures = oldMeasures;
  if (lastIdx >= 0 && oldMeasures[lastIdx]?.barline?.type === "final") {
    updatedMeasures = [...oldMeasures];
    const old = updatedMeasures[lastIdx]!;
    const { barline: _, ...rest } = old;
    updatedMeasures[lastIdx] = rest;
  }
  const newGlobalMeasures = [...updatedMeasures, newGlobal];

  const newParts: Part[] = score.parts.map((part) => ({
    ...part,
    measures: [...part.measures, createEmptyPartMeasure()],
  }));

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
    parts: newParts,
  };
}

/**
 * Insert a new empty measure before the given index.
 * Index 0 inserts at the start; index === measureCount appends at end.
 * Throws if index is out of range [0, measureCount].
 */
export function insertMeasure(score: Score, index: number): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index > measureCount) {
    throw new RangeError(`insertMeasure: index ${index} out of range [0, ${measureCount}]`);
  }

  const usedIds = collectScoreIds(score);
  let id = generateId();
  while (usedIds.has(id)) id = generateId();
  const newGlobal: GlobalMeasure = { id };
  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newGlobal,
    ...score.global.measures.slice(index),
  ];

  const newParts: Part[] = score.parts.map((part) => ({
    ...part,
    measures: [...part.measures.slice(0, index), createEmptyPartMeasure(), ...part.measures.slice(index)],
  }));

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
    parts: newParts,
  };
}

/**
 * Delete the measure at the given index.
 * Throws if index is out of range or if it would remove the last measure.
 */
export function deleteMeasure(score: Score, index: number): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`deleteMeasure: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  if (measureCount <= 1) {
    throw new RangeError("deleteMeasure: cannot delete the last measure");
  }

  const newGlobalMeasures = [...score.global.measures.slice(0, index), ...score.global.measures.slice(index + 1)];

  const newParts: Part[] = score.parts.map((part) => ({
    ...part,
    measures: [...part.measures.slice(0, index), ...part.measures.slice(index + 1)],
  }));

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
    parts: newParts,
  };
}

/**
 * Set the time signature at a given measure index.
 * Pass `null` to remove an explicit time signature (inherit from previous).
 * Throws if index is out of range.
 */
export function setTimeSignature(score: Score, index: number, time: TimeSignature | null): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`setTimeSignature: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  const oldMeasure = score.global.measures[index]!;
  const newMeasure: GlobalMeasure = { ...oldMeasure };

  if (time === null) {
    delete newMeasure.time;
  } else {
    newMeasure.time = time;
  }

  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newMeasure,
    ...score.global.measures.slice(index + 1),
  ];

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
  };
}

/**
 * Set the key signature at a given measure index.
 * Pass `null` to remove an explicit key signature (inherit from previous).
 * Throws if index is out of range.
 */
export function setKeySignature(score: Score, index: number, key: KeySignature | null): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`setKeySignature: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  const oldMeasure = score.global.measures[index]!;
  const newMeasure: GlobalMeasure = { ...oldMeasure };

  if (key === null) {
    delete newMeasure.key;
  } else {
    newMeasure.key = key;
  }

  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newMeasure,
    ...score.global.measures.slice(index + 1),
  ];

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
  };
}

/**
 * Set the repeat-start marker at a given measure index.
 * Pass `null` to remove the marker.
 * Throws if index is out of range.
 */
export function setRepeatStart(score: Score, index: number, repeatStart: RepeatStart | null): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`setRepeatStart: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  const oldMeasure = score.global.measures[index]!;
  const newMeasure: GlobalMeasure = { ...oldMeasure };

  if (repeatStart === null) {
    delete newMeasure.repeatStart;
  } else {
    newMeasure.repeatStart = repeatStart;
  }

  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newMeasure,
    ...score.global.measures.slice(index + 1),
  ];

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
  };
}

/**
 * Set a part-specific measure-repeat (simile) sign.
 *
 * Pass `null` to remove the sign. The sign belongs only on the first measure
 * of its covered range; callers are responsible for validating that the
 * preceding source measures and following covered measures exist.
 */
export function setMeasureRepeat(
  score: Score,
  partIndex: number,
  measureIndex: number,
  measureRepeat: MeasureRepeat | null,
): Score {
  const part = score.parts[partIndex];
  if (!Number.isInteger(partIndex) || partIndex < 0 || !part) {
    throw new RangeError(`setMeasureRepeat: part index ${partIndex} out of range [0, ${score.parts.length - 1}]`);
  }
  if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= part.measures.length) {
    throw new RangeError(
      `setMeasureRepeat: measure index ${measureIndex} out of range [0, ${part.measures.length - 1}]`,
    );
  }
  if (measureRepeat && (!Number.isInteger(measureRepeat.number) || measureRepeat.number < 1)) {
    throw new RangeError(`setMeasureRepeat: number ${measureRepeat.number} must be a positive integer`);
  }

  const oldMeasure = part.measures[measureIndex]!;
  const newMeasure: PartMeasure = { ...oldMeasure };
  if (measureRepeat === null) delete newMeasure.measureRepeat;
  else newMeasure.measureRepeat = measureRepeat;

  const newPart = {
    ...part,
    measures: [...part.measures.slice(0, measureIndex), newMeasure, ...part.measures.slice(measureIndex + 1)],
  };
  return {
    ...score,
    parts: [...score.parts.slice(0, partIndex), newPart, ...score.parts.slice(partIndex + 1)],
  };
}

/**
 * Set the barline type at a given measure index.
 * Pass `null` to remove an explicit barline.
 * Throws if index is out of range.
 */
export function setBarline(score: Score, index: number, barline: Barline | null): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`setBarline: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  const oldMeasure = score.global.measures[index]!;
  const newMeasure: GlobalMeasure = { ...oldMeasure };

  if (barline === null) {
    delete newMeasure.barline;
  } else {
    newMeasure.barline = barline;
  }

  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newMeasure,
    ...score.global.measures.slice(index + 1),
  ];

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
  };
}

/**
 * Set the repeat-end marker at a given measure index.
 * Pass `null` to remove the marker.
 * Throws if index is out of range.
 */
export function setRepeatEnd(score: Score, index: number, repeatEnd: RepeatEnd | null): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`setRepeatEnd: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  const oldMeasure = score.global.measures[index]!;
  const newMeasure: GlobalMeasure = { ...oldMeasure };

  if (repeatEnd === null) {
    delete newMeasure.repeatEnd;
  } else {
    newMeasure.repeatEnd = repeatEnd;
  }

  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newMeasure,
    ...score.global.measures.slice(index + 1),
  ];

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
  };
}

/**
 * Set the ending marker at a given measure index.
 * Pass `null` to remove the marker.
 * Throws if index is out of range.
 */
export function setEnding(score: Score, index: number, ending: Ending | null): Score {
  const measureCount = score.global.measures.length;

  if (!Number.isInteger(index) || index < 0 || index >= measureCount) {
    throw new RangeError(`setEnding: index ${index} out of range [0, ${measureCount - 1}]`);
  }

  const oldMeasure = score.global.measures[index]!;
  const newMeasure: GlobalMeasure = { ...oldMeasure };

  if (ending === null) {
    delete newMeasure.ending;
  } else {
    newMeasure.ending = ending;
  }

  const newGlobalMeasures = [
    ...score.global.measures.slice(0, index),
    newMeasure,
    ...score.global.measures.slice(index + 1),
  ];

  return {
    ...score,
    global: { ...score.global, measures: newGlobalMeasures },
  };
}

/**
 * Set a clef at the start of a part measure.
 * Pass `null` to remove explicit clefs from this measure.
 * Throws if part/measure index is out of range.
 */
export interface SetClefOptions {
  /** Optional in-measure rhythmic position for explicit clef changes. */
  position?: { fraction: [number, number] };
  /** Optional staff number for multi-staff parts. */
  staff?: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x || 1;
}

function reduceFraction(numerator: number, denominator: number): [number, number] {
  if (denominator === 0) {
    return [0, 1];
  }
  const sign = denominator < 0 ? -1 : 1;
  const n = numerator * sign;
  const d = Math.abs(denominator);
  const g = gcd(n, d);
  return [n / g, d / g];
}

function fractionCompare(a: [number, number], b: [number, number]): number {
  const left = a[0] * b[1];
  const right = b[0] * a[1];
  return left - right;
}

function positionedClefFraction(entry: PositionedClef): [number, number] {
  if (!entry.position) {
    return [0, 1];
  }
  return reduceFraction(entry.position.fraction[0], entry.position.fraction[1]);
}

export function setClef(
  score: Score,
  measureIndex: number,
  partIndex: number,
  clef: Clef | null,
  options?: SetClefOptions,
): Score {
  const partCount = score.parts.length;
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) {
    throw new RangeError(`setClef: partIndex ${partIndex} out of range [0, ${partCount - 1}]`);
  }

  const measureCount = score.global.measures.length;
  if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= measureCount) {
    throw new RangeError(`setClef: measureIndex ${measureIndex} out of range [0, ${measureCount - 1}]`);
  }

  const targetPart = score.parts[partIndex]!;
  const oldMeasure = targetPart.measures[measureIndex]!;
  const newMeasure: PartMeasure = { ...oldMeasure };

  if (clef === null) {
    delete newMeasure.clefs;
  } else {
    if (!options?.position) {
      newMeasure.clefs = [{ clef }];
    } else {
      const targetFraction = reduceFraction(options.position.fraction[0], options.position.fraction[1]);
      const positioned: PositionedClef = {
        clef,
        position: { fraction: targetFraction },
        ...(options.staff === undefined ? {} : { staff: options.staff }),
      };

      const existing = oldMeasure.clefs ?? [];
      const filtered = existing.filter((entry) => {
        const sameStaff = (entry.staff ?? null) === (positioned.staff ?? null);
        if (!sameStaff) {
          return true;
        }
        const entryFraction = positionedClefFraction(entry);
        return fractionCompare(entryFraction, targetFraction) !== 0;
      });

      const merged = [...filtered, positioned];
      merged.sort((a, b) => {
        const byPosition = fractionCompare(positionedClefFraction(a), positionedClefFraction(b));
        if (byPosition !== 0) {
          return byPosition;
        }
        return (a.staff ?? 0) - (b.staff ?? 0);
      });

      newMeasure.clefs = merged;
    }
  }

  const newPart: Part = {
    ...targetPart,
    measures: [
      ...targetPart.measures.slice(0, measureIndex),
      newMeasure,
      ...targetPart.measures.slice(measureIndex + 1),
    ],
  };

  const newParts = [...score.parts.slice(0, partIndex), newPart, ...score.parts.slice(partIndex + 1)];

  return {
    ...score,
    parts: newParts,
  };
}

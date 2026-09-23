/**
 * Measure operations — pure functions for adding, inserting, and deleting
 * measures in a Score. Each function returns a new Score (immutable).
 */

import type { Score } from "../model/score";
import type {
  GlobalMeasure,
  PartMeasure,
  RepeatStart,
  RepeatEnd,
  Ending,
  MeasureRepeat,
  StaffGroupingDisplayOverride,
} from "../model/measure";
import type { Part } from "../model/part";
import type { GroupingDisplay, TimeSignature } from "../model/time";
import type { StaffMeter, StaffMeterChange, StaffMeterSynchronization } from "../model/staffMeter";
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
  } else if (!options?.position && options?.staff === undefined) {
    newMeasure.clefs = [{ clef }];
  } else {
    const targetFraction = options?.position
      ? reduceFraction(options.position.fraction[0], options.position.fraction[1])
      : ([0, 1] as [number, number]);
    const positioned: PositionedClef = {
      clef,
      ...(options?.position ? { position: { fraction: targetFraction } } : {}),
      ...(options?.staff === undefined ? {} : { staff: options.staff }),
    };

    const existing = oldMeasure.clefs ?? [];
    const filtered = existing.filter((entry) => {
      if (fractionCompare(positionedClefFraction(entry), targetFraction) !== 0) {
        return true;
      }
      if (positioned.staff === undefined) {
        return entry.staff !== undefined;
      }
      return entry.staff !== positioned.staff && entry.staff !== undefined;
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

/**
 * Toggle whether the clef change(s) at a measure boundary are rendered.
 * `hide` suppresses the clef glyph while preserving its effect on pitch
 * interpretation (per MNX `clef.hide`) — used for editorial clef changes
 * that shouldn't be visible on the page. Applies to every positioned clef
 * entry at that measure (e.g. all staves of a grand-staff part), since
 * clef selection is currently measure-scoped rather than per-entry.
 */
export function setClefHidden(score: Score, measureIndex: number, partIndex: number, hidden: boolean): Score {
  const partCount = score.parts.length;
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) {
    throw new RangeError(`setClefHidden: partIndex ${partIndex} out of range [0, ${partCount - 1}]`);
  }

  const measureCount = score.global.measures.length;
  if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= measureCount) {
    throw new RangeError(`setClefHidden: measureIndex ${measureIndex} out of range [0, ${measureCount - 1}]`);
  }

  const targetPart = score.parts[partIndex]!;
  const oldMeasure = targetPart.measures[measureIndex]!;
  const existing = oldMeasure.clefs;
  if (!existing || existing.length === 0) return score;

  const clefs = existing.map((entry) => {
    const clef: Clef = { ...entry.clef };
    if (hidden) {
      clef.hide = true;
    } else {
      delete clef.hide;
    }
    return { ...entry, clef };
  });

  const newMeasure: PartMeasure = { ...oldMeasure, clefs };
  const newPart: Part = {
    ...targetPart,
    measures: [
      ...targetPart.measures.slice(0, measureIndex),
      newMeasure,
      ...targetPart.measures.slice(measureIndex + 1),
    ],
  };

  return {
    ...score,
    parts: [...score.parts.slice(0, partIndex), newPart, ...score.parts.slice(partIndex + 1)],
  };
}

/**
 * Set (or clear) a per-staff grouping-display occurrence override on a part
 * measure. Pass `groupingDisplay: null` to remove any existing override for
 * that staff — the measure then falls back to the time signature's own
 * occurrence override and the document house style.
 *
 * This is presentation-only: it never touches the semantic
 * `TimeSignature.beatStructure` automatic beaming reads.
 */
export function setGroupingDisplayOverride(
  score: Score,
  measureIndex: number,
  partIndex: number,
  staff: number,
  groupingDisplay: GroupingDisplay | null,
): Score {
  const partCount = score.parts.length;
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) {
    throw new RangeError(`setGroupingDisplayOverride: partIndex ${partIndex} out of range [0, ${partCount - 1}]`);
  }
  const measureCount = score.global.measures.length;
  if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= measureCount) {
    throw new RangeError(
      `setGroupingDisplayOverride: measureIndex ${measureIndex} out of range [0, ${measureCount - 1}]`,
    );
  }
  if (!Number.isInteger(staff) || staff < 1) {
    throw new RangeError("setGroupingDisplayOverride: staff must be a positive integer");
  }

  const targetPart = score.parts[partIndex]!;
  const oldMeasure = targetPart.measures[measureIndex]!;
  const remaining = (oldMeasure.groupingDisplayOverrides ?? []).filter((entry) => entry.staff !== staff);
  const nextOverrides: StaffGroupingDisplayOverride[] =
    groupingDisplay === null ? remaining : [...remaining, { staff, groupingDisplay }];
  nextOverrides.sort((a, b) => a.staff - b.staff);

  const newMeasure: PartMeasure = { ...oldMeasure };
  if (nextOverrides.length > 0) {
    newMeasure.groupingDisplayOverrides = nextOverrides;
  } else {
    delete newMeasure.groupingDisplayOverrides;
  }

  const newPart: Part = {
    ...targetPart,
    measures: [
      ...targetPart.measures.slice(0, measureIndex),
      newMeasure,
      ...targetPart.measures.slice(measureIndex + 1),
    ],
  };

  return {
    ...score,
    parts: [...score.parts.slice(0, partIndex), newPart, ...score.parts.slice(partIndex + 1)],
  };
}

/**
 * Set a staff-local synchronous meter on a part measure, effective from
 * this measure onward until changed or reset (see
 * `setStaffMeterToGlobal`). Replaces any existing `staffMeters` entry for
 * this staff at this measure.
 *
 * This is a pure authoring operation: it does not validate `synchronization`
 * against the score's effective global meter at this point (that requires
 * walking global measure history — see `resolveStaffMeterChange` in
 * `../model/staffMeter`). Callers that need to surface a validation error to
 * the user before applying the edit should call `resolveStaffMeterChange`
 * themselves first.
 */
export function setStaffMeter(
  score: Score,
  measureIndex: number,
  partIndex: number,
  staff: number,
  meter: StaffMeter,
  synchronization: StaffMeterSynchronization,
): Score {
  const partCount = score.parts.length;
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) {
    throw new RangeError(`setStaffMeter: partIndex ${partIndex} out of range [0, ${partCount - 1}]`);
  }
  const measureCount = score.global.measures.length;
  if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= measureCount) {
    throw new RangeError(`setStaffMeter: measureIndex ${measureIndex} out of range [0, ${measureCount - 1}]`);
  }
  if (!Number.isInteger(staff) || staff < 1) {
    throw new RangeError("setStaffMeter: staff must be a positive integer");
  }

  const targetPart = score.parts[partIndex]!;
  const oldMeasure = targetPart.measures[measureIndex]!;
  const remaining = (oldMeasure.staffMeters ?? []).filter((entry) => entry.staff !== staff);
  const nextChanges: StaffMeterChange[] = [...remaining, { staff, meter, synchronization }];
  nextChanges.sort((a, b) => a.staff - b.staff);

  const newMeasure: PartMeasure = { ...oldMeasure, staffMeters: nextChanges };

  const newPart: Part = {
    ...targetPart,
    measures: [
      ...targetPart.measures.slice(0, measureIndex),
      newMeasure,
      ...targetPart.measures.slice(measureIndex + 1),
    ],
  };

  return {
    ...score,
    parts: [...score.parts.slice(0, partIndex), newPart, ...score.parts.slice(partIndex + 1)],
  };
}

/**
 * Reset a staff back to following the global meter from this part measure
 * onward, ending a prior `setStaffMeter` declaration for this staff. Pass
 * `remove: true` to instead delete any `staffMeters` entry for this staff at
 * this measure outright (used when clearing a reset that was authored on a
 * measure with no other staff-meter activity, so the measure stops carrying
 * an empty vendor-extension array).
 */
export function setStaffMeterToGlobal(
  score: Score,
  measureIndex: number,
  partIndex: number,
  staff: number,
  options?: { remove?: boolean },
): Score {
  const partCount = score.parts.length;
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) {
    throw new RangeError(`setStaffMeterToGlobal: partIndex ${partIndex} out of range [0, ${partCount - 1}]`);
  }
  const measureCount = score.global.measures.length;
  if (!Number.isInteger(measureIndex) || measureIndex < 0 || measureIndex >= measureCount) {
    throw new RangeError(`setStaffMeterToGlobal: measureIndex ${measureIndex} out of range [0, ${measureCount - 1}]`);
  }
  if (!Number.isInteger(staff) || staff < 1) {
    throw new RangeError("setStaffMeterToGlobal: staff must be a positive integer");
  }

  const targetPart = score.parts[partIndex]!;
  const oldMeasure = targetPart.measures[measureIndex]!;
  const remaining = (oldMeasure.staffMeters ?? []).filter((entry) => entry.staff !== staff);
  const nextChanges: StaffMeterChange[] = options?.remove ? remaining : [...remaining, { staff, useGlobal: true }];
  nextChanges.sort((a, b) => a.staff - b.staff);

  const newMeasure: PartMeasure = { ...oldMeasure };
  if (nextChanges.length > 0) {
    newMeasure.staffMeters = nextChanges;
  } else {
    delete newMeasure.staffMeters;
  }

  const newPart: Part = {
    ...targetPart,
    measures: [
      ...targetPart.measures.slice(0, measureIndex),
      newMeasure,
      ...targetPart.measures.slice(measureIndex + 1),
    ],
  };

  return {
    ...score,
    parts: [...score.parts.slice(0, partIndex), newPart, ...score.parts.slice(partIndex + 1)],
  };
}

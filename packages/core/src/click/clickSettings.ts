import { resolveMeter, type TimeSignature } from "../model/time";
import type { RhythmicPosition } from "../model/measure";

export interface ClickSetting {
  readonly subdivision: number;
  readonly grouping?: readonly number[];
}

export interface ClickInstruction {
  readonly bpm?: number;
  readonly location?: RhythmicPosition;
  readonly clickSubdivision?: number;
  readonly clickGrouping?: readonly number[];
}

export interface ClickMeasure {
  readonly time?: TimeSignature;
  readonly instructions: readonly ClickInstruction[];
}

interface ClickSettingChange extends ClickSetting {
  readonly atBeat: number;
}

export interface MeasureClickSetting extends ClickSetting {
  readonly changes: readonly ClickSettingChange[];
}

/** Group boundaries in quarter notes, including the end of the nominal bar. */
export function resolveClickGrouping(meter: TimeSignature, subdivision: number, grouping: readonly number[]): number[] {
  resolveMeter(meter);
  if (!Number.isInteger(subdivision) || subdivision < 1 || subdivision > 5) {
    throw new RangeError("Click grouping requires a click subdivision from 1 to 5.");
  }
  if (
    !Array.isArray(grouping) ||
    grouping.length === 0 ||
    grouping.some((group) => !Number.isSafeInteger(group) || group <= 0)
  ) {
    throw new RangeError("Click grouping must contain positive safe integers.");
  }
  const total = meter.count * subdivision;
  if (grouping.reduce((sum, group) => sum + group, 0) !== total) {
    throw new RangeError(
      `Click grouping must sum to ${total} for ${meter.count}/${meter.unit} at division ${subdivision}.`,
    );
  }
  const boundaries = [0];
  let position = 0;
  for (const group of grouping) {
    position += group;
    boundaries.push((position * 4) / (meter.unit * subdivision));
  }
  return boundaries;
}

export function clickSettingAt(resolution: MeasureClickSetting, beat: number): ClickSetting {
  let setting: ClickSetting = resolution;
  for (const change of resolution.changes) {
    if (change.atBeat > beat) break;
    setting = change;
  }
  return { subdivision: setting.subdivision, grouping: setting.grouping };
}

/** Written settings, independent of repeat expansion or performance timing. */
export function compileClickSettings(measures: readonly ClickMeasure[]): MeasureClickSetting[] {
  let setting: ClickSetting = { subdivision: 1 };
  let meter: TimeSignature = { count: 4, unit: 4 };
  return measures.map((measure, index) => {
    meter = measure.time ?? meter;
    const byPosition = new Map<number, { setting: ClickSetting; explicit: boolean }>();
    for (const instruction of measure.instructions) {
      const value = instruction.clickSubdivision;
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 5)) {
        throw new RangeError(`Bar ${index + 1}: click subdivision must be an integer from 0 to 5.`);
      }
      if (instruction.clickGrouping !== undefined) {
        resolveClickGrouping(meter, value ?? 0, instruction.clickGrouping);
      }
      const fraction = instruction.location?.fraction ?? [0, 1];
      const atBeat = (fraction[0] / fraction[1]) * 4;
      if (value !== undefined) {
        byPosition.set(atBeat, {
          setting: { subdivision: value, grouping: instruction.clickGrouping },
          explicit: true,
        });
      } else if (instruction.bpm !== undefined && !byPosition.get(atBeat)?.explicit) {
        byPosition.set(atBeat, { setting: { subdivision: 1 }, explicit: false });
      }
    }
    const changes = [...byPosition]
      .map(([atBeat, entry]) => ({ atBeat, ...entry.setting }))
      .sort((a, b) => a.atBeat - b.atBeat);
    const result = { ...setting, changes };
    const active = clickSettingAt(result, 0);
    if (active.grouping) resolveClickGrouping(meter, active.subdivision, active.grouping);
    setting = clickSettingAt(result, Infinity);
    return result;
  });
}

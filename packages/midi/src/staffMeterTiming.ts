import {
  ratioToNumber,
  resolveStaffMeterTimeline,
  type EffectiveStaffMeter,
  type GlobalMeasure,
  type Part,
  type TimeSignature,
} from "@viritura/core";

export type StaffMeterTable = readonly ReadonlyMap<number, EffectiveStaffMeter>[];

/** Resolve the active global time signature at a measure index. */
export function resolveActiveTime(globalMeasures: readonly GlobalMeasure[], measureIndex: number): TimeSignature {
  for (let index = measureIndex; index >= 0; index--) {
    const time = globalMeasures[index]?.time;
    if (time) return time;
  }
  return { count: 4, unit: 4 };
}

/** Resolve every effective staff-local meter for one part. */
export function resolvePartStaffMeterTable(part: Part, globalMeasures: readonly GlobalMeasure[]): StaffMeterTable {
  const globalTimeAt = globalMeasures.map((_, index) => resolveActiveTime(globalMeasures, index));
  return resolveStaffMeterTimeline(
    part.measures.map((measure) => measure.staffMeters),
    globalTimeAt,
  ).table;
}

/** Scale written beats on a staff onto the shared global-measure axis. */
export function staffMeterRatioAt(table: StaffMeterTable, measureIndex: number, staff: number | undefined): number {
  if (staff === undefined) return 1;
  const effective = table[measureIndex]?.get(staff);
  return effective ? ratioToNumber(effective.ratioToGlobal) : 1;
}

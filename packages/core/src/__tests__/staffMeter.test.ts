import { describe, expect, it } from "vitest";
import {
  isStaffMeterReset,
  ratioToNumber,
  resolveStaffMeterChange,
  resolveStaffMeterTimeline,
  StaffMeterValidationError,
  type StaffMeterChange,
} from "../model/staffMeter";
import type { TimeSignature } from "../model/time";

const global4_4: TimeSignature = { count: 4, unit: 4 };

describe("resolveStaffMeterChange", () => {
  it("accepts sharedDuration when local and global durations match (3/4 vs 6/8)", () => {
    const effective = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
      { count: 3, unit: 4 },
    );
    expect(effective).toBeDefined();
    expect(effective!.ratioToGlobal).toEqual({ num: 1, den: 1 });
    expect(ratioToNumber(effective!.ratioToGlobal)).toBe(1);
  });

  it("rejects sharedDuration when durations differ", () => {
    expect(() =>
      resolveStaffMeterChange(
        undefined,
        { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
        global4_4,
      ),
    ).toThrow(StaffMeterValidationError);
  });

  it("derives an exact fitMeasure ratio (2/4 vs 6/8 -> 2/3)", () => {
    const effective = resolveStaffMeterChange(
      undefined,
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      { count: 2, unit: 4 },
    );
    expect(effective!.ratioToGlobal).toEqual({ num: 2, den: 3 });
  });

  it("derives an exact fitMeasure ratio (4/4 vs 12/8 -> 2/3)", () => {
    const effective = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 12, unit: 8 }, synchronization: "fitMeasure" },
      global4_4,
    );
    expect(effective!.ratioToGlobal).toEqual({ num: 2, den: 3 });
  });

  it("rejects an invalid beatStructure that doesn't sum to count", () => {
    expect(() =>
      resolveStaffMeterChange(
        undefined,
        {
          staff: 1,
          meter: { count: 6, unit: 8, beatStructure: [2, 2] },
          synchronization: "fitMeasure",
        },
        global4_4,
      ),
    ).toThrow(StaffMeterValidationError);
  });

  it("reset clears inherited state", () => {
    const previous = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      global4_4,
    );
    const reset = resolveStaffMeterChange(previous, { staff: 1, useGlobal: true }, global4_4);
    expect(reset).toBeUndefined();
  });

  it("no change re-resolves to an equal state when the global meter is unchanged", () => {
    const previous = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      global4_4,
    );
    expect(resolveStaffMeterChange(previous, undefined, global4_4)).toEqual(previous);
  });

  it("re-derives the fitMeasure ratio against a changed global meter on inheritance", () => {
    // Declared against global 2/4 (ratio 2/3): local 6/8 (3 beats) vs
    // global 2/4 (2 beats).
    const previous = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      { count: 2, unit: 4 },
    );
    expect(previous!.ratioToGlobal).toEqual({ num: 2, den: 3 });

    // The global meter changes to 4/4 with no new staffMeters entry for
    // staff 1 -> the SAME authored local meter (6/8, fitMeasure) must now
    // derive the ratio against 4/4 (4 beats): 4/3, not the stale 2/3.
    const reResolved = resolveStaffMeterChange(previous, undefined, { count: 4, unit: 4 });
    expect(reResolved!.timeSignature).toEqual({ count: 6, unit: 8 });
    expect(reResolved!.synchronization).toBe("fitMeasure");
    expect(reResolved!.ratioToGlobal).toEqual({ num: 4, den: 3 });
  });

  it("surfaces a sharedDuration mismatch when a global meter change breaks a previously-valid inherited declaration", () => {
    // Declared against global 3/4 (equal durations: 6/8 vs 3/4, both 3 beats).
    const previous = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
      { count: 3, unit: 4 },
    );
    expect(previous).toBeDefined();

    // The global meter changes to 4/4 (4 beats): the inherited 6/8 (3 beats)
    // no longer shares the global measure's duration.
    expect(() => resolveStaffMeterChange(previous, undefined, global4_4)).toThrow(StaffMeterValidationError);
  });
});

describe("isStaffMeterReset", () => {
  it("narrows a reset entry", () => {
    const change: StaffMeterChange = { staff: 1, useGlobal: true };
    expect(isStaffMeterReset(change)).toBe(true);
  });

  it("returns false for a set entry", () => {
    const change: StaffMeterChange = {
      staff: 1,
      meter: { count: 6, unit: 8 },
      synchronization: "sharedDuration",
    };
    expect(isStaffMeterReset(change)).toBe(false);
  });
});

describe("resolveStaffMeterTimeline", () => {
  it("carries a declaration forward across measures with no new entry", () => {
    const { table, issues } = resolveStaffMeterTimeline(
      [[{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }], undefined, undefined],
      [global4_4, global4_4, global4_4],
    );
    expect(issues).toHaveLength(0);
    expect(table[0]!.get(1)?.timeSignature).toEqual({ count: 6, unit: 8 });
    expect(table[1]!.get(1)?.timeSignature).toEqual({ count: 6, unit: 8 });
    expect(table[2]!.get(1)?.timeSignature).toEqual({ count: 6, unit: 8 });
  });

  it("clears state on reset and keeps prior state on an invalid entry", () => {
    const { table, issues } = resolveStaffMeterTimeline(
      [
        [{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }],
        undefined,
        // Invalid: sharedDuration but durations differ -> kept previous state.
        [{ staff: 1, meter: { count: 5, unit: 8 }, synchronization: "sharedDuration" }],
        [{ staff: 1, useGlobal: true }],
      ],
      [global4_4, global4_4, global4_4, global4_4],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measureIndex).toBe(2);
    expect(table[0]!.get(1)).toBeDefined();
    expect(table[1]!.get(1)).toEqual(table[0]!.get(1)); // inherited
    expect(table[2]!.get(1)).toEqual(table[1]!.get(1)); // kept despite the invalid entry
    expect(table[3]!.has(1)).toBe(false); // reset
  });

  it("recomputes an inherited fitMeasure ratio from the measure where the global meter changes", () => {
    // Staff 1 declares fitMeasure 6/8 while global is 2/4 (ratio 2/3), then
    // the global meter changes to 4/4 with no new staffMeters entry for
    // staff 1 — the inherited 6/8 declaration must be re-derived against
    // 4/4 (ratio 4/3) from that measure onward.
    const { table, issues } = resolveStaffMeterTimeline(
      [[{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }], undefined, undefined],
      [
        { count: 2, unit: 4 },
        { count: 4, unit: 4 },
        { count: 4, unit: 4 },
      ],
    );
    expect(issues).toHaveLength(0);
    expect(table[0]!.get(1)?.ratioToGlobal).toEqual({ num: 2, den: 3 });
    expect(table[1]!.get(1)?.ratioToGlobal).toEqual({ num: 4, den: 3 });
    expect(table[2]!.get(1)?.ratioToGlobal).toEqual({ num: 4, den: 3 });
    // The authored local meter/synchronization are unchanged throughout.
    expect(table[1]!.get(1)?.timeSignature).toEqual({ count: 6, unit: 8 });
    expect(table[1]!.get(1)?.synchronization).toBe("fitMeasure");
  });

  it("recomputes a retained fitMeasure ratio after an invalid replacement at a global meter change", () => {
    const { table, issues } = resolveStaffMeterTimeline(
      [
        [{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }],
        [{ staff: 1, meter: { count: 0, unit: 8 }, synchronization: "fitMeasure" }],
      ],
      [
        { count: 2, unit: 4 },
        { count: 4, unit: 4 },
      ],
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]!.measureIndex).toBe(1);
    expect(table[0]!.get(1)?.ratioToGlobal).toEqual({ num: 2, den: 3 });
    expect(table[1]!.get(1)?.timeSignature).toEqual({ count: 6, unit: 8 });
    expect(table[1]!.get(1)?.ratioToGlobal).toEqual({ num: 4, den: 3 });
  });

  it("reports one issue and retains the last valid sharedDuration state when both replacement and inheritance are invalid", () => {
    const { table, issues } = resolveStaffMeterTimeline(
      [
        [{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" }],
        [{ staff: 1, meter: { count: 0, unit: 8 }, synchronization: "sharedDuration" }],
      ],
      [
        { count: 3, unit: 4 },
        { count: 4, unit: 4 },
      ],
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]!.measureIndex).toBe(1);
    expect(table[1]!.get(1)).toEqual(table[0]!.get(1));
  });

  it("reports a sharedDuration mismatch and keeps the prior state when a global meter change breaks it mid-run", () => {
    // Staff 1 declares sharedDuration 6/8 while global is 3/4 (equal, 3
    // beats). The global meter then changes to 4/4 (4 beats) with no new
    // staffMeters entry — the inherited declaration is no longer valid.
    const { table, issues } = resolveStaffMeterTimeline(
      [[{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" }], undefined],
      [
        { count: 3, unit: 4 },
        { count: 4, unit: 4 },
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measureIndex).toBe(1);
    expect(issues[0]!.staff).toBe(1);
    expect(issues[0]!.error).toBeInstanceOf(StaffMeterValidationError);
    // The stale (declaration-time) entry is kept rather than dropped.
    expect(table[1]!.get(1)).toEqual(table[0]!.get(1));
  });
});

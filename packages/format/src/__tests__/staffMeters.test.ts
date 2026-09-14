import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";
import { resolveStaffMeterChange, StaffMeterValidationError, type TimeSignature } from "@viritura/core";

function scoreWithStaffMeters(options: { globalTime?: { count: number; unit: number }; staffMeters?: unknown }) {
  const globalTime = options.globalTime ?? { count: 4, unit: 4 };
  const partMeasureExt: Record<string, unknown> = {};
  if (options.staffMeters !== undefined) {
    partMeasureExt["staffMeters"] = options.staffMeters;
  }
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: globalTime }] },
    parts: [
      {
        measures: [
          {
            sequences: [{ content: [] }],
            ...(Object.keys(partMeasureExt).length > 0 ? { _x: { viritura: partMeasureExt } } : {}),
          },
        ],
      },
    ],
  };
}

describe("part-measure staffMeters extension", () => {
  it("round-trips a sharedDuration staff-meter set", () => {
    const source = scoreWithStaffMeters({
      globalTime: { count: 3, unit: 4 },
      staffMeters: [{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" }],
    });
    const parsed = parseMnx(source);

    expect(parsed.parts[0]!.measures[0]!.staffMeters).toEqual([
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
    ]);
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("round-trips a fitMeasure staff-meter set with an authored beatStructure", () => {
    const source = scoreWithStaffMeters({
      globalTime: { count: 4, unit: 4 },
      staffMeters: [
        {
          staff: 2,
          meter: { count: 12, unit: 8, beatStructure: [3, 3, 3, 3] },
          synchronization: "fitMeasure",
        },
      ],
    });
    const parsed = parseMnx(source);

    expect(parsed.parts[0]!.measures[0]!.staffMeters).toEqual([
      {
        staff: 2,
        meter: { count: 12, unit: 8, beatStructure: [3, 3, 3, 3] },
        synchronization: "fitMeasure",
      },
    ]);
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("round-trips a reset-to-global entry", () => {
    const source = scoreWithStaffMeters({ staffMeters: [{ staff: 1, useGlobal: true }] });
    const parsed = parseMnx(source);

    expect(parsed.parts[0]!.measures[0]!.staffMeters).toEqual([{ staff: 1, useGlobal: true }]);
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("rejects a staff-meter-set missing a required field", () => {
    const result = validateRawScore(
      scoreWithStaffMeters({ staffMeters: [{ staff: 1, meter: { count: 6, unit: 8 } }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive staff number", () => {
    const result = validateRawScore(
      scoreWithStaffMeters({
        staffMeters: [{ staff: 0, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unsupported synchronization value", () => {
    const result = validateRawScore(
      scoreWithStaffMeters({
        staffMeters: [{ staff: 1, meter: { count: 6, unit: 8 }, synchronization: "independent" }],
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("resolveStaffMeterChange semantic validation", () => {
  const global: TimeSignature = { count: 3, unit: 4 };

  it("accepts sharedDuration when durations are equal (3/4 vs 6/8)", () => {
    const effective = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
      global,
    );
    expect(effective?.ratioToGlobal).toEqual({ num: 1, den: 1 });
  });

  it("rejects sharedDuration when durations differ (4/4 vs 6/8)", () => {
    expect(() =>
      resolveStaffMeterChange(
        undefined,
        { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
        { count: 4, unit: 4 },
      ),
    ).toThrow(StaffMeterValidationError);
  });

  it("derives the exact fitMeasure ratio (2/4 vs 6/8 -> 2/3)", () => {
    const effective = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      { count: 2, unit: 4 },
    );
    expect(effective?.ratioToGlobal).toEqual({ num: 2, den: 3 });
  });

  it("derives the exact fitMeasure ratio (4/4 vs 12/8 -> 2/3)", () => {
    const effective = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 12, unit: 8 }, synchronization: "fitMeasure" },
      { count: 4, unit: 4 },
    );
    expect(effective?.ratioToGlobal).toEqual({ num: 2, den: 3 });
  });

  it("reset clears inherited state", () => {
    const previous = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      global,
    );
    const reset = resolveStaffMeterChange(previous, { staff: 1, useGlobal: true }, global);
    expect(reset).toBeUndefined();
  });

  it("absence of a change inherits the previous state", () => {
    const previous = resolveStaffMeterChange(
      undefined,
      { staff: 1, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
      global,
    );
    expect(resolveStaffMeterChange(previous, undefined, global)).toEqual(previous);
  });
});

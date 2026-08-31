import { describe, expect, it } from "vitest";
import type { MeasureBounds } from "@viritura/renderer";

import { partLocalStaffIndex, pointerToMeasure } from "../hitTesting";

function measure(staffIndex: number, y: number, partIndex = staffIndex): MeasureBounds {
  return {
    index: 2,
    partIndex,
    staffIndex,
    x: 100,
    y,
    width: 200,
    height: 48,
    prefixWidth: 0,
    totalBeats: 4,
    beatAnchors: [],
  };
}

describe("pointerToMeasure", () => {
  it("returns the actual visual staff instead of defaulting to staff zero", () => {
    const bounds = [measure(0, 100), measure(3, 220), measure(7, 340)];

    expect(pointerToMeasure(180, 365, bounds)).toEqual({
      partIndex: 7,
      staffIndex: 7,
      localStaffIndex: 0,
      measureIndex: 2,
    });
  });

  it("chooses the nearest staff when padded hit regions overlap", () => {
    const bounds = [measure(2, 100, 1), measure(5, 180, 1)];

    expect(pointerToMeasure(180, 176, bounds)).toMatchObject({ staffIndex: 5, localStaffIndex: 1 });
  });
});

describe("partLocalStaffIndex", () => {
  it("maps a later single-staff part's global index back to local staff zero", () => {
    const bounds = [measure(0, 100, 0), measure(4, 180, 4)];

    expect(partLocalStaffIndex(bounds, 4, 4)).toBe(0);
  });

  it("maps grand-staff visual rows to local indices", () => {
    const bounds = [measure(6, 100, 3), measure(7, 180, 3)];

    expect(partLocalStaffIndex(bounds, 3, 6)).toBe(0);
    expect(partLocalStaffIndex(bounds, 3, 7)).toBe(1);
  });
});

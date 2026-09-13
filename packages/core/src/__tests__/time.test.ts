import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultBeatStructure, resolveMeter } from "../model/time";

interface MeterFixture {
  defaults: Array<{ count: number; unit: number; beatStructure: number[] }>;
  authored: { count: number; unit: number; beatStructure: number[]; beatBoundaries: number[] };
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../test-fixtures/meter-definitions.json"), "utf8"),
) as MeterFixture;

describe("meter resolution", () => {
  for (const testCase of fixture.defaults) {
    it(`resolves the conventional default for ${testCase.count}/${testCase.unit}`, () => {
      expect(defaultBeatStructure(testCase.count, testCase.unit)).toEqual(testCase.beatStructure);
    });
  }

  it("preserves an authored irregular structure and computes quarter-beat boundaries", () => {
    expect(resolveMeter(fixture.authored)).toEqual({
      count: fixture.authored.count,
      unit: fixture.authored.unit,
      beatStructure: fixture.authored.beatStructure,
      beatBoundaries: fixture.authored.beatBoundaries,
      source: "authored",
    });
  });

  it("rejects malformed authored structures", () => {
    expect(() => resolveMeter({ count: 5, unit: 8, beatStructure: [2, 2] })).toThrow(/sum to count/);
    expect(() => resolveMeter({ count: 5, unit: 8, beatStructure: [2, 0, 3] })).toThrow(/positive integers/);
  });
});

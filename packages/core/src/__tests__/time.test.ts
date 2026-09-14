import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultBeatStructure, resolveMeter, resolveGroupingDisplay, type TimeSignature } from "../model/time";

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

describe("resolveGroupingDisplay cascade precedence", () => {
  function ts(count: number, unit: number, beatStructure?: number[]): TimeSignature {
    return beatStructure ? { count, unit, beatStructure } : { count, unit };
  }

  it("keeps an ordinary/default meter standard under an additive house style", () => {
    const time = ts(4, 4);
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "additive")).toBe("standard");
  });

  it("keeps a redundant authored structure standard under the house style", () => {
    // [1,1,1,1] duplicates the automatic default for 4/4, so it is not
    // "non-default" even though explicitly authored.
    const time = ts(4, 4, [1, 1, 1, 1]);
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "annotation")).toBe("standard");
  });

  it("applies the house style to a structurally non-default meter", () => {
    const time = ts(7, 8, [3, 2, 2]);
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "additive")).toBe("additive");
  });

  it("lets the time signature's own occurrence override win over the house style", () => {
    const time: TimeSignature = { ...ts(7, 8, [3, 2, 2]), groupingDisplay: "annotation" };
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "additive")).toBe("annotation");
  });

  it("lets a staff occurrence override win over the time occurrence and house style", () => {
    const time: TimeSignature = { ...ts(7, 8, [3, 2, 2]), groupingDisplay: "annotation" };
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "additive", "standard")).toBe("standard");
  });

  it("falls back to standard for a single-group structure even when forced", () => {
    const time: TimeSignature = { ...ts(4, 4, [4]), groupingDisplay: "additive" };
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "standard")).toBe("standard");
  });

  it("falls back to standard for a symbolic display even when forced", () => {
    const time: TimeSignature = { ...ts(4, 4, [2, 2]), display: "common", groupingDisplay: "additive" };
    const resolved = resolveMeter(time);
    expect(resolveGroupingDisplay(time, resolved, "standard", "annotation")).toBe("standard");
  });
});

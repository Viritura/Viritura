import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMnx } from "@viritura/format";
import { describe, expect, it } from "vitest";
import { resolveAutomaticBeamGroups } from "../commands/autoBeaming";

interface AutoBeamingCase {
  name: string;
  score: unknown;
  excludedEventIds: string[];
  expected: string[][];
}

interface AutoBeamingFixture {
  cases: AutoBeamingCase[];
}

interface IrregularAutoBeamingCase {
  name: string;
  count: number;
  unit: number;
  eventCount?: number;
  eventBase?: "eighth" | "16th";
  beatStructure?: number[];
  expectedGroupSizes: number[];
}

const fixturePath = resolve(__dirname, "../../../../test-fixtures/auto-beaming.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as AutoBeamingFixture;
const irregularFixturePath = resolve(__dirname, "../../../../test-fixtures/irregular-auto-beaming.json");
const irregularFixture = JSON.parse(readFileSync(irregularFixturePath, "utf8")) as {
  cases: IrregularAutoBeamingCase[];
};

describe("automatic beaming conformance", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const score = parseMnx(testCase.score);
      const measure = score.parts[0]!.measures[0]!;
      const groups = measure.sequences.flatMap((sequence) =>
        resolveAutomaticBeamGroups(
          sequence.content,
          score.global.measures[0]!.time!,
          new Set(testCase.excludedEventIds),
        ),
      );

      expect(groups.map((beam) => beam.events)).toEqual(testCase.expected);
    });
  }
});

describe("irregular meter automatic beaming", () => {
  for (const testCase of irregularFixture.cases) {
    it(testCase.name, () => {
      const rawTime = {
        count: testCase.count,
        unit: testCase.unit,
        ...(testCase.beatStructure ? { _x: { viritura: { beatStructure: testCase.beatStructure } } } : {}),
      };
      const content = Array.from({ length: testCase.eventCount ?? testCase.count }, (_, index) => ({
        id: `e${index + 1}`,
        duration: { base: testCase.eventBase ?? "eighth" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      }));
      const score = parseMnx({
        mnx: { version: 1 },
        global: { measures: [{ time: rawTime }] },
        parts: [{ measures: [{ sequences: [{ content }] }] }],
      });
      const measure = score.parts[0]!.measures[0]!;
      const groups = resolveAutomaticBeamGroups(
        measure.sequences[0]!.content,
        score.global.measures[0]!.time!,
        new Set(),
      );

      expect(groups.map((beam) => beam.events.length)).toEqual(testCase.expectedGroupSizes);
    });
  }
});

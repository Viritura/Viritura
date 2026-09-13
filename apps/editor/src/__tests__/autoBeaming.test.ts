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

const fixturePath = resolve(__dirname, "../../../../test-fixtures/auto-beaming.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as AutoBeamingFixture;

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

import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { parseMnx } from "@viritura/format";
import { validateRawScore } from "@viritura/format";
import * as stories from "../stories/viritura-extensions/structure/StaffMeters.stories";

type StoryModule = typeof stories;
type StoryKey = Exclude<keyof StoryModule, "default">;

function mnxJsonFromStory(key: StoryKey): string {
  const story = stories[key];
  const element = (story.render as () => ReactElement)();
  const mnxJson = (element.props as { mnxJson: string }).mnxJson;
  expect(typeof mnxJson).toBe("string");
  return mnxJson;
}

const STORY_KEYS = Object.keys(stories).filter((key): key is StoryKey => key !== "default") as StoryKey[];

describe("StaffMeters storybook fixtures", () => {
  it("exposes every documented staff-meter scenario", () => {
    expect(STORY_KEYS.sort()).toEqual(
      [
        "SharedDurationSixEightOverThreeFour",
        "FitMeasureSixEightOverTwoFour",
        "FitMeasureTwelveEightOverFourFour",
        "ResetToGlobal",
      ].sort(),
    );
  });

  for (const key of STORY_KEYS) {
    it(`${key} produces valid, parseable MNX`, () => {
      const json = mnxJsonFromStory(key);
      const parsed = JSON.parse(json);
      const result = validateRawScore(parsed);
      expect(result.ok).toBe(true);
      expect(() => parseMnx(parsed)).not.toThrow();
    });
  }

  it("SharedDurationSixEightOverThreeFour authors a 3/4 global measure with a sharedDuration 6/8 staff meter", () => {
    const parsed = JSON.parse(mnxJsonFromStory("SharedDurationSixEightOverThreeFour"));
    expect(parsed.global.measures[0].time).toEqual({ count: 3, unit: 4 });
    expect(parsed.parts[0].measures[0]._x.viritura.staffMeters).toEqual([
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
    ]);
    const parsedScore = parseMnx(parsed);
    expect(parsedScore.parts[0]!.measures[0]!.staffMeters).toEqual([
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
    ]);
  });

  it("FitMeasureSixEightOverTwoFour authors a 2/4 global measure with a fitMeasure 6/8 staff meter", () => {
    const parsed = JSON.parse(mnxJsonFromStory("FitMeasureSixEightOverTwoFour"));
    expect(parsed.global.measures[0].time).toEqual({ count: 2, unit: 4 });
    expect(parsed.parts[0].measures[0]._x.viritura.staffMeters).toEqual([
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ]);
  });

  it("FitMeasureTwelveEightOverFourFour authors a 4/4 global measure with a fitMeasure 12/8 staff meter", () => {
    const parsed = JSON.parse(mnxJsonFromStory("FitMeasureTwelveEightOverFourFour"));
    expect(parsed.global.measures[0].time).toEqual({ count: 4, unit: 4 });
    expect(parsed.parts[0].measures[0]._x.viritura.staffMeters).toEqual([
      {
        staff: 2,
        meter: { count: 12, unit: 8, beatStructure: [3, 3, 3, 3] },
        synchronization: "fitMeasure",
      },
    ]);
  });

  it("ResetToGlobal authors a third measure resetting staff 2 back to the global meter", () => {
    const parsed = JSON.parse(mnxJsonFromStory("ResetToGlobal"));
    expect(parsed.parts[0].measures).toHaveLength(3);
    expect(parsed.parts[0].measures[0]._x.viritura.staffMeters).toEqual([
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ]);
    expect(parsed.parts[0].measures[2]._x.viritura.staffMeters).toEqual([{ staff: 2, useGlobal: true }]);

    const parsedScore = parseMnx(parsed);
    expect(parsedScore.parts[0]!.measures[2]!.staffMeters).toEqual([{ staff: 2, useGlobal: true }]);
  });
});

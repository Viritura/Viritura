import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { parseMnx } from "@viritura/format";
import { validateRawScore } from "@viritura/format";
import * as stories from "../stories/viritura-extensions/structure/GroupingDisplay.stories";

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

describe("GroupingDisplay storybook fixtures", () => {
  it("exposes every documented cascade scenario", () => {
    expect(STORY_KEYS.sort()).toEqual(
      [
        "Standard",
        "HouseStyleAdditive",
        "HouseStyleAnnotation",
        "DefaultMeterStaysStandard",
        "OccurrenceOverride",
        "PerStaffOverridePrecedence",
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

  it("HouseStyleAdditive authors a structurally non-default beatStructure", () => {
    const parsed = JSON.parse(mnxJsonFromStory("HouseStyleAdditive"));
    expect(parsed.global.measures[0].time._x.viritura.beatStructure).toEqual([3, 2, 2]);
    expect(parsed._x.viritura.timeSignatures.score.nonDefaultGroupingDisplay).toBe("additive");
  });

  it("DefaultMeterStaysStandard authors no beatStructure at all", () => {
    const parsed = JSON.parse(mnxJsonFromStory("DefaultMeterStaysStandard"));
    expect(parsed.global.measures[0].time._x).toBeUndefined();
    expect(parsed._x.viritura.timeSignatures.score.nonDefaultGroupingDisplay).toBe("additive");
  });

  it("PerStaffOverridePrecedence authors staff 1's override plus the time occurrence and house style", () => {
    const parsed = JSON.parse(mnxJsonFromStory("PerStaffOverridePrecedence"));
    expect(parsed.parts[0].measures[0]._x.viritura.groupingDisplayOverrides).toEqual([
      { staff: 1, groupingDisplay: "standard" },
    ]);
    expect(parsed.global.measures[0].time._x.viritura.groupingDisplay).toBe("additive");
    expect(parsed._x.viritura.timeSignatures.score.nonDefaultGroupingDisplay).toBe("annotation");
  });
});

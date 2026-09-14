import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { parseMnx, validateRawScore } from "@viritura/format";
import * as stories from "../stories/engraving-behavior/rhythm-spacing/AutomaticBeaming.stories";

type StoryKey = Exclude<keyof typeof stories, "default">;

const STORY_KEYS = Object.keys(stories).filter((key): key is StoryKey => key !== "default") as StoryKey[];

describe("AutomaticBeaming story fixtures", () => {
  it("covers the automatic grouping behavior matrix", () => {
    expect(STORY_KEYS.sort()).toEqual(
      [
        "MeterDefaults",
        "AuthoredIrregularGroups",
        "HalfBarDurationSensitivity",
        "RestsInsideIrregularGroups",
        "ShortUnitFallbacks",
      ].sort(),
    );
  });

  for (const key of STORY_KEYS) {
    it(`${key} produces valid, parseable MNX`, () => {
      const element = (stories[key].render as () => ReactElement)();
      const mnxJson = (element.props as { mnxJson: string }).mnxJson;
      const raw = JSON.parse(mnxJson);
      expect(validateRawScore(raw).ok).toBe(true);
      expect(() => parseMnx(raw)).not.toThrow();
    });
  }
});

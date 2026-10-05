import { describe, expect, it } from "vitest";
import { parseMnx } from "@viritura/format";
import { ERASING_STAFF_TEXT_MNX, TEXT_FRAME_MNX } from "../stories/storyFixtures/textFrameScore";

describe("text frame story fixture", () => {
  it("parses the erasing staff-frame example with a valid pinned musical offset", () => {
    const score = parseMnx(JSON.parse(ERASING_STAFF_TEXT_MNX));
    expect(score.parts[0].measures[0].expressions?.[0]).toMatchObject({
      manualOffset: [0, -5],
      avoidCollisions: false,
      frame: { eraseBackground: true, padding: 0.5, border: "solid" },
    });
  });

  it("parses one frame of each locator kind onto the full score", () => {
    const score = parseMnx(structuredClone(TEXT_FRAME_MNX));
    expect(score.scores?.[0]?.textFrames?.map((frame) => frame.locator)).toEqual([
      { type: "page", pageIndex: 0 },
      { type: "globalMeasure", measureId: "m9" },
      { type: "event", partId: "vn", eventId: "e-G" },
    ]);
  });
});

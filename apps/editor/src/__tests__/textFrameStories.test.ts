import { describe, expect, it } from "vitest";
import { parseMnx } from "@viritura/format";
import { TEXT_FRAME_MNX } from "../stories/storyFixtures/textFrameScore";

describe("text frame story fixture", () => {
  it("parses one frame of each locator kind onto the full score", () => {
    const score = parseMnx(structuredClone(TEXT_FRAME_MNX));
    expect(score.scores?.[0]?.textFrames?.map((frame) => frame.locator)).toEqual([
      { type: "page", pageIndex: 0 },
      { type: "globalMeasure", measureId: "m9" },
      { type: "event", partId: "vn", eventId: "e-G" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { selectionVoiceIndex } from "./selectionVoice";

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [
    {
      name: "Harp",
      staves: 2,
      measures: [
        {
          sequences: [
            { staff: 1, content: [] },
            { staff: 2, content: [] },
            { staff: 1, content: [] },
            { staff: 2, content: [] },
          ],
        },
      ],
    },
  ],
};

describe("selectionVoiceIndex", () => {
  it("treats each staff's first sequence as voice one", () => {
    expect(selectionVoiceIndex(score, "p0/m0/s0/top")).toBe(0);
    expect(selectionVoiceIndex(score, "p0/m0/s1/lower")).toBe(0);
  });

  it("counts only preceding sequences on the same staff", () => {
    expect(selectionVoiceIndex(score, "p0/m0/s2/top-second")).toBe(1);
    expect(selectionVoiceIndex(score, "p0/m0/s3/lower-second")).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { getScoreTimeline } from "./scoreTimeline";

describe("performed MCP tempo changes", () => {
  it("includes mid-bar changes on the initial and D.C. passes without mocking MIDI generation", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 4, unit: 4 },
            tempos: [
              { bpm: 120, value: { base: "quarter" } },
              { bpm: 60, value: { base: "quarter" }, location: { fraction: [1, 2] } },
            ],
            fine: { location: { fraction: [1, 1] } },
          },
          { jump: { type: "dcAlFine", location: { fraction: [1, 1] } } },
        ],
      },
      parts: [],
    };
    expect(getScoreTimeline(score, {}).tempoChanges).toEqual([
      { measure: 1, playthrough: 0, beatInMeasure: 0, startSeconds: 0, bpm: 120 },
      { measure: 1, playthrough: 0, beatInMeasure: 2, startSeconds: 1, bpm: 60 },
      { measure: 2, playthrough: 0, beatInMeasure: 0, startSeconds: 3, bpm: 60 },
      { measure: 1, playthrough: 1, beatInMeasure: 0, startSeconds: 7, bpm: 120 },
      { measure: 1, playthrough: 1, beatInMeasure: 2, startSeconds: 8, bpm: 60 },
    ]);
  });
});

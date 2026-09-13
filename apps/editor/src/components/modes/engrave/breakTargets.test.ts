import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { breakTargetAfterBarline, markerMeasureBeforeBreak } from "./breakTargets";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: 8 }, (_, index) => ({ id: `m${index + 1}` })),
    },
    parts: [{ measures: Array.from({ length: 8 }, () => ({ sequences: [] })) }],
    scores: [
      {
        multimeasureRests: [{ start: "m3", duration: 3 }],
      },
    ],
  };
}

describe("engrave break targets", () => {
  it("places a break after the complete multimeasure rest", () => {
    expect(breakTargetAfterBarline(score(), 0, 2)).toBe("m6");
  });

  it("uses actual visible measures for auto-detected multimeasure rests", () => {
    const autoDetected = score();
    autoDetected.scores![0]!.multimeasureRests = undefined;

    expect(breakTargetAfterBarline(autoDetected, 0, 2, [0, 1, 2, 5, 6, 7])).toBe("m6");
    expect(markerMeasureBeforeBreak(autoDetected, 0, 5, [0, 1, 2, 5, 6, 7])).toBe(2);
  });

  it("places ordinary breaks after the clicked measure", () => {
    expect(breakTargetAfterBarline(score(), 0, 5)).toBe("m7");
  });

  it("anchors a post-MMR break marker to the visible rest barline", () => {
    expect(markerMeasureBeforeBreak(score(), 0, 5)).toBe(2);
  });

  it("does not create a break after the final measure", () => {
    expect(breakTargetAfterBarline(score(), 0, 7)).toBeUndefined();
  });
});

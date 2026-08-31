import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import {
  measureIndexFromElementId,
  partIndexFromElementId,
  measureRangeFromElementId,
  resolveInsertMeasureIndex,
  deleteKeySignatureByElementId,
  ENDING_PRESETS,
} from "../commands/signatureCommands";

/** Minimal 3-measure score for testing. */
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}, { barline: { type: "final" } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [
              {
                content: [{ type: "event" as const, id: "ev1", duration: { base: "whole" as const }, rest: {} }],
              },
            ],
          },
          {
            sequences: [
              {
                content: [{ type: "event" as const, id: "ev2", duration: { base: "whole" as const }, rest: {} }],
              },
            ],
          },
          {
            sequences: [
              {
                content: [{ type: "event" as const, id: "ev3", duration: { base: "whole" as const }, rest: {} }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("measureIndexFromElementId", () => {
  it("returns measure index from a valid part-scoped element ID", () => {
    expect(measureIndexFromElementId("p0/m1/s0/ev2", makeScore())).toBe(1);
  });

  it("returns null for a null element ID", () => {
    expect(measureIndexFromElementId(null, makeScore())).toBeNull();
  });

  it("returns null for an invalid element ID format", () => {
    expect(measureIndexFromElementId("invalid", makeScore())).toBeNull();
  });

  it("returns null for an out-of-range measure index", () => {
    expect(measureIndexFromElementId("p0/m99/s0/ev1", makeScore())).toBeNull();
  });

  it("resolves a global element ID", () => {
    expect(measureIndexFromElementId("m1/tempo0", makeScore())).toBe(1);
  });

  it("maps a start-of-measure barline to the previous measure", () => {
    expect(measureIndexFromElementId("m2/barline", makeScore())).toBe(1);
  });

  it("clamps a barline at measure 0 to measure 0", () => {
    expect(measureIndexFromElementId("m0/barline", makeScore())).toBe(0);
  });
});

describe("partIndexFromElementId", () => {
  it("returns part index from a valid element ID", () => {
    expect(partIndexFromElementId("p0/m1/s0/ev2", makeScore())).toBe(0);
  });

  it("returns null for a global element ID", () => {
    expect(partIndexFromElementId("m1/s0/ev2", makeScore())).toBeNull();
  });

  it("returns null for a null element ID", () => {
    expect(partIndexFromElementId(null, makeScore())).toBeNull();
  });
});

describe("deleteKeySignatureByElementId", () => {
  it("removes the explicit global key through any staff-scoped rendered copy", () => {
    const score = makeScore();
    score.global.measures[1]!.key = { fifths: 3 };

    const result = deleteKeySignatureByElementId(score, "p0/m1/key");

    expect(result).not.toBeNull();
    expect(result!.global.measures[1]!.key).toBeUndefined();
    expect(result!.global.measures[0]!.key).toEqual({ fifths: 0 });
  });

  it("does not delete a system-start continuation copy with no explicit key", () => {
    expect(deleteKeySignatureByElementId(makeScore(), "p0/m1/key")).toBeNull();
  });
});

describe("measureRangeFromElementId", () => {
  it("returns a single-measure range for a valid element ID", () => {
    expect(measureRangeFromElementId("p0/m1/s0/ev2", makeScore())).toEqual({ start: 1, end: 1 });
  });

  it("returns null for a null element ID", () => {
    expect(measureRangeFromElementId(null, makeScore())).toBeNull();
  });
});

describe("ENDING_PRESETS", () => {
  it("includes the expected presets", () => {
    expect(ENDING_PRESETS.map((p) => p.label)).toContain("1st Ending");
    expect(ENDING_PRESETS.map((p) => p.label)).toContain("2nd Ending");
  });
});

describe("resolveInsertMeasureIndex", () => {
  it("inserts at the barline boundary for a selected barline", () => {
    // m2/barline sits before measure 2 → insert at index 2.
    expect(resolveInsertMeasureIndex("m2/barline", makeScore())).toBe(2);
  });

  it("inserts after the measure for a selected note/measure", () => {
    expect(resolveInsertMeasureIndex("p0/m1/s0/ev2", makeScore())).toBe(2);
  });

  it("appends when there is no resolvable selection", () => {
    expect(resolveInsertMeasureIndex(null, makeScore())).toBe(3);
  });

  it("clamps a barline index beyond the score to an append", () => {
    expect(resolveInsertMeasureIndex("m99/barline", makeScore())).toBe(3);
  });
});

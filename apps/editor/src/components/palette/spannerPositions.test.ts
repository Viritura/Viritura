import type { Score } from "@viritura/core";
import { describe, expect, it } from "vitest";
import { eventPositionFraction, resolveSpannerPositions } from "./spannerPositions";

const SCORE: Score = {
  mnx: { version: 1 },
  global: {
    measures: [{ id: "first", time: { count: 3, unit: 8 } }, { id: "second" }],
  },
  parts: [
    {
      name: "Flute",
      measures: [
        {
          sequences: [
            {
              content: [
                { type: "event", id: "a", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                { type: "event", id: "b", duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                { type: "event", id: "c", duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                { type: "event", id: "d", duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("palette spanner positions", () => {
  it("computes event positions as whole-note fractions", () => {
    expect(eventPositionFraction(SCORE, { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1 })).toEqual([
      1, 4,
    ]);
    expect(
      eventPositionFraction(SCORE, { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 1 }, true),
    ).toEqual([3, 8]);
  });

  it("normalizes reversed ranges and includes the final event", () => {
    const positions = resolveSpannerPositions(
      SCORE,
      {
        kind: "range",
        startElementId: "p0/m1/s0/d",
        endElementId: "p0/m0/s0/b",
        anchorElementId: "p0/m1/s0/d",
      },
      0,
    );

    expect(positions?.start).toMatchObject({ measureIndex: 0, eventIndex: 1 });
    expect(positions?.position.fraction).toEqual([1, 4]);
    expect(positions?.end).toEqual({ measure: "second", position: { fraction: [3, 8] } });
  });

  it("ends single selections at the inherited measure duration", () => {
    const positions = resolveSpannerPositions(SCORE, { kind: "single", elementId: "p0/m1/s0/c" }, 0);

    expect(positions?.end).toEqual({ measure: "second", position: { fraction: [3, 8] } });
  });
});

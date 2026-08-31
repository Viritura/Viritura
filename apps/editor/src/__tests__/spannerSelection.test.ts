import { describe, it, expect } from "vitest";
import { resolveEventLocation } from "../score/ElementPath";
import type { Score } from "@viritura/core";

/**
 * Regression test: backwards (right-to-left) range selection normalization.
 *
 * When shift-clicking right-to-left, startElementId is the later note and
 * endElementId is the earlier one. computeSpannerPositions must normalize
 * the order so spanners always go from earlier to later position.
 *
 * This tests the underlying ordering logic that computeSpannerPositions uses.
 */

function makeTestScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }],
    },
    parts: [
      {
        name: "Test",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { octave: 4, step: "C" } }] },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    id: "ev1",
                    notes: [{ pitch: { octave: 4, step: "D" } }],
                  },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    id: "ev2",
                    notes: [{ pitch: { octave: 4, step: "E" } }],
                  },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    id: "ev3",
                    notes: [{ pitch: { octave: 4, step: "F" } }],
                  },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    id: "ev4",
                    notes: [{ pitch: { octave: 4, step: "G" } }],
                  },
                  {
                    type: "event",
                    duration: { base: "quarter" },
                    id: "ev5",
                    notes: [{ pitch: { octave: 4, step: "A" } }],
                  },
                  {
                    type: "event",
                    duration: { base: "half" },
                    id: "ev6",
                    notes: [{ pitch: { octave: 4, step: "B" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    layouts: [],
    scores: [],
  } as unknown as Score;
}

/** Normalize two locations so loc1 is always before loc2 (same logic as computeSpannerPositions). */
function normalizeLocations(
  loc1: { measureIndex: number; eventIndex: number },
  loc2: { measureIndex: number; eventIndex: number },
) {
  const before =
    loc2.measureIndex < loc1.measureIndex ||
    (loc2.measureIndex === loc1.measureIndex && loc2.eventIndex < loc1.eventIndex);
  if (before) {
    return { start: loc2, end: loc1, swapped: true };
  }
  return { start: loc1, end: loc2, swapped: false };
}

describe("spanner selection normalization", () => {
  const score = makeTestScore();

  it("resolves forward selection correctly (no swap needed)", () => {
    const loc1 = resolveEventLocation("p0/m0/s0/ev1", score);
    const loc2 = resolveEventLocation("p0/m0/s0/ev3", score);
    expect(loc1).not.toBeNull();
    expect(loc2).not.toBeNull();

    const { start, end, swapped } = normalizeLocations(loc1!, loc2!);
    expect(swapped).toBe(false);
    expect(start.eventIndex).toBe(1); // ev1
    expect(end.eventIndex).toBe(3); // ev3
  });

  it("normalizes backwards (right-to-left) selection within same measure", () => {
    // User clicks ev3 first, then shift-clicks ev1
    const loc1 = resolveEventLocation("p0/m0/s0/ev3", score); // "start" = later note
    const loc2 = resolveEventLocation("p0/m0/s0/ev1", score); // "end" = earlier note
    expect(loc1).not.toBeNull();
    expect(loc2).not.toBeNull();

    const { start, end, swapped } = normalizeLocations(loc1!, loc2!);
    expect(swapped).toBe(true);
    expect(start.eventIndex).toBe(1); // ev1 (earlier)
    expect(end.eventIndex).toBe(3); // ev3 (later)
  });

  it("normalizes backwards selection across measures", () => {
    // User clicks ev4 (measure 1) first, then shift-clicks ev1 (measure 0)
    const loc1 = resolveEventLocation("p0/m1/s0/ev4", score); // measure 1
    const loc2 = resolveEventLocation("p0/m0/s0/ev1", score); // measure 0
    expect(loc1).not.toBeNull();
    expect(loc2).not.toBeNull();

    const { start, end, swapped } = normalizeLocations(loc1!, loc2!);
    expect(swapped).toBe(true);
    expect(start.measureIndex).toBe(0); // measure 0 (earlier)
    expect(end.measureIndex).toBe(1); // measure 1 (later)
  });

  it("does not swap forward selection across measures", () => {
    const loc1 = resolveEventLocation("p0/m0/s0/ev2", score); // measure 0
    const loc2 = resolveEventLocation("p0/m1/s0/ev5", score); // measure 1
    expect(loc1).not.toBeNull();
    expect(loc2).not.toBeNull();

    const { start, end, swapped } = normalizeLocations(loc1!, loc2!);
    expect(swapped).toBe(false);
    expect(start.measureIndex).toBe(0);
    expect(end.measureIndex).toBe(1);
  });

  it("handles same position (no swap)", () => {
    const loc1 = resolveEventLocation("p0/m0/s0/ev2", score);
    const loc2 = resolveEventLocation("p0/m0/s0/ev2", score);
    expect(loc1).not.toBeNull();

    const { swapped } = normalizeLocations(loc1!, loc2!);
    expect(swapped).toBe(false);
  });
});

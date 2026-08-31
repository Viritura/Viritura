import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import {
  getTupletScaleAt,
  advanceCursorByNotatedDuration,
  moveCursorToNextEvent,
  moveCursorToPreviousEvent,
} from "../commands/cursorCommands";

/**
 * Regression tests for tuplet-aware cursor advancement.
 *
 * Bug: cursor advance after entering a note inside a tuplet did not apply
 * the tuplet's outer/inner scale, so it overshot the next slot. Entering
 * three eighth notes inside a 3:2 eighth-triplet would put the cursor at
 * 1.5 then 2.0 (past the tuplet) instead of 1+1/3, 1+2/3, 2.0.
 */

function scoreWithTriplet(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "P",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  {
                    type: "tuplet",
                    inner: { multiple: 3, duration: { base: "eighth" } },
                    outer: { multiple: 2, duration: { base: "eighth" } },
                    content: [
                      { type: "event", duration: { base: "eighth" }, rest: {} },
                      { type: "event", duration: { base: "eighth" }, rest: {} },
                      { type: "event", duration: { base: "eighth" }, rest: {} },
                    ],
                  },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

describe("getTupletScaleAt", () => {
  it("returns 1 outside any tuplet", () => {
    const score = scoreWithTriplet();
    expect(getTupletScaleAt(score, 0, 0, 0, 0)).toBe(1);
    expect(getTupletScaleAt(score, 0, 0, 0, 0.5)).toBe(1);
    expect(getTupletScaleAt(score, 0, 0, 0, 2.0)).toBe(1);
    expect(getTupletScaleAt(score, 0, 0, 0, 3.5)).toBe(1);
  });

  it("returns 2/3 inside a 3:2 eighth triplet", () => {
    const score = scoreWithTriplet();
    // Tuplet spans real beats [1.0, 2.0)
    expect(getTupletScaleAt(score, 0, 0, 0, 1.0)).toBeCloseTo(2 / 3);
    expect(getTupletScaleAt(score, 0, 0, 0, 1 + 1 / 3)).toBeCloseTo(2 / 3);
    expect(getTupletScaleAt(score, 0, 0, 0, 1 + 2 / 3)).toBeCloseTo(2 / 3);
  });

  it("treats end of tuplet as outside (uses scale=1 for the next event)", () => {
    const score = scoreWithTriplet();
    expect(getTupletScaleAt(score, 0, 0, 0, 2.0)).toBe(1);
  });
});

describe("advanceCursorByNotatedDuration", () => {
  it("advances by 1/3 beat per eighth inside a 3:2 eighth triplet", () => {
    const score = scoreWithTriplet();
    const cursor = { measureIndex: 0, beatPosition: 1.0, partIndex: 0 };
    const next = advanceCursorByNotatedDuration(score, cursor, 0.5, 0, 1);
    expect(next.measureIndex).toBe(0);
    expect(next.beatPosition).toBeCloseTo(1 + 1 / 3, 6);
  });

  it("3 successive eighth steps inside the triplet land exactly at tuplet end", () => {
    const score = scoreWithTriplet();
    let cursor = { measureIndex: 0, beatPosition: 1.0, partIndex: 0 };
    cursor = advanceCursorByNotatedDuration(score, cursor, 0.5, 0, 1);
    cursor = advanceCursorByNotatedDuration(score, cursor, 0.5, 0, 1);
    cursor = advanceCursorByNotatedDuration(score, cursor, 0.5, 0, 1);
    expect(cursor.beatPosition).toBeCloseTo(2.0, 6);
  });

  it("advances by full notated beats outside the tuplet", () => {
    const score = scoreWithTriplet();
    const cursor = { measureIndex: 0, beatPosition: 0, partIndex: 0 };
    const next = advanceCursorByNotatedDuration(score, cursor, 1, 0, 1);
    expect(next.beatPosition).toBeCloseTo(1.0);
  });

  it("retreats by 1/3 beat per eighth inside the triplet (left arrow)", () => {
    const score = scoreWithTriplet();
    const cursor = { measureIndex: 0, beatPosition: 1 + 2 / 3, partIndex: 0 };
    const prev = advanceCursorByNotatedDuration(score, cursor, 0.5, 0, -1);
    expect(prev.beatPosition).toBeCloseTo(1 + 1 / 3, 6);
  });
});

/**
 * Regression: event-step navigation (moveCursorToNext/PreviousEvent) skipped
 * over a multi-note tremolo entirely because eventStartBeats only registered
 * cursor stops for top-level events and tuplet children — a tremolo block
 * advanced the beat counter without offering a stop, so the cursor could
 * never land on it.
 */
function scoreWithTremolo(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "P",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "half" }, rest: {} },
                  {
                    type: "tremolo",
                    marks: 3,
                    outer: { multiple: 1, duration: { base: "half" } },
                    content: [
                      { type: "event", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                      { type: "event", duration: { base: "half" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

describe("event-step navigation across a tremolo", () => {
  it("stops at the tremolo start beat moving forward", () => {
    const score = scoreWithTremolo();
    // First event occupies beats [0, 2); tremolo starts at beat 2.
    const cursor = { measureIndex: 0, beatPosition: 0, partIndex: 0 };
    const next = moveCursorToNextEvent(score, cursor, 0);
    expect(next.measureIndex).toBe(0);
    expect(next.beatPosition).toBeCloseTo(2.0, 6);
  });

  it("stops at the tremolo start beat moving backward from measure end", () => {
    const score = scoreWithTremolo();
    const cursor = { measureIndex: 0, beatPosition: 4.0, partIndex: 0 };
    const prev = moveCursorToPreviousEvent(score, cursor, 0);
    expect(prev.beatPosition).toBeCloseTo(2.0, 6);
  });
});

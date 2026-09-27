import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { findTransposeTarget } from "../keyboard/noteInputArrows";
import type { KeyboardHandlerContext } from "../keyboard/types";

function note(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "whole" },
    notes: [{ id: `${id}-n`, pitch: { step: "C", octave: 4 } }],
  };
}

describe("findTransposeTarget", () => {
  it("falls back to the lane's own sequence in an earlier bar, whatever its slot", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
      parts: [
        {
          measures: [
            {
              sequences: [
                { voice: "down1", directionHint: "lower", content: [note("low")] },
                { voice: "up1", directionHint: "upper", content: [note("high")] },
              ],
            },
            // Up 1 is absent here, so the target comes from bar 0.
            { sequences: [{ voice: "down1", directionHint: "lower", content: [note("low2")] }] },
          ],
        },
      ],
    };

    const loc = findTransposeTarget(
      score,
      {} as KeyboardHandlerContext,
      { measureIndex: 1, beatPosition: 0, partIndex: 0, staffIndex: 0 },
      { lane: 1 },
    );

    expect(loc).toEqual({ measureIndex: 0, sequenceIndex: 1, eventIndex: 0 });
  });
});

import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { selectedStaffDestination } from "./textFrameContext";

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{}] },
  parts: [
    {
      staves: 2,
      measures: [
        {
          sequences: [
            {
              staff: 2,
              voice: "lower",
              content: [
                { type: "event", id: "first", duration: { base: "quarter" }, rest: {} },
                { type: "event", id: "second", duration: { base: "quarter" }, rest: {} },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("selected staff text destination", () => {
  it("uses the selected event's rhythmic position, staff and voice", () => {
    expect(
      selectedStaffDestination(score, {
        kind: "single",
        elementId: "p0/m0/s0/second",
        elementType: "rest",
      }),
    ).toEqual({
      partIndex: 0,
      measureIndex: 0,
      expression: { position: { fraction: [1, 4] }, staff: 2, voice: "lower", placement: "above" },
    });
  });

  it("uses the source-local staff and measure start for a measure selection", () => {
    expect(
      selectedStaffDestination(score, {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startMeasure: 0,
        endMeasure: 0,
        startStaffIndex: 5,
        endStaffIndex: 5,
        startLocalStaffIndex: 1,
      })?.expression,
    ).toEqual({ position: { fraction: [0, 1] }, staff: 2, placement: "above" });
  });

  it("does not invent a destination for a page-frame or missing-event selection", () => {
    expect(
      selectedStaffDestination(score, { kind: "single", elementId: "text-frame/tf1", elementType: "text-frame" }),
    ).toBeUndefined();
    expect(
      selectedStaffDestination(score, { kind: "single", elementId: "p0/m0/s0/missing", elementType: "event" }),
    ).toBeUndefined();
  });
});

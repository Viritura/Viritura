import { describe, expect, it } from "vitest";
import type { MeasureBounds } from "@viritura/renderer";
import type { Score } from "@viritura/core";
import { buildDragSnapPoints } from "./dragSnapPoints";

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }] },
  parts: [
    {
      name: "Harp",
      measures: [
        {
          measureRepeat: { number: 1 },
          sequences: [{ content: [] }],
        },
      ],
    },
  ],
};

const bounds: MeasureBounds[] = [
  {
    index: 0,
    partIndex: 0,
    staffIndex: 0,
    x: 100,
    y: 100,
    width: 160,
    height: 48,
    prefixWidth: 20,
    totalBeats: 4,
    beatAnchors: [
      [0, 120],
      [4, 260],
    ],
  },
];

describe("buildDragSnapPoints", () => {
  it("builds Alt-drag beat positions for an empty measure-repeat bar", () => {
    const points = buildDragSnapPoints(score, null, bounds, 0, true);
    expect(points.find((point) => point.beat === 2)).toEqual({
      x: 190,
      beat: 2,
      measureIndex: 0,
    });
    expect(points).toHaveLength(17);
  });
});

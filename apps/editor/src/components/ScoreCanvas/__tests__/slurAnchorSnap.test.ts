import { describe, expect, it } from "vitest";
import type { MeasureBounds } from "@viritura/renderer";
import { SpatialIndex } from "@viritura/renderer";
import type { Score } from "@viritura/core";
import { buildSlurAnchorPoints } from "../slurAnchorSnap";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("buildSlurAnchorPoints", () => {
  it("uses the layout measure boundary for a final event's end edge", () => {
    const spatialIndex = new SpatialIndex([{ id: "p0/m0/s0/ev1", x: 100, y: 80, width: 12, height: 12 }]);
    const bounds: MeasureBounds[] = [
      {
        index: 0,
        measureId: "m1",
        partIndex: 0,
        staffIndex: 0,
        x: 40,
        y: 60,
        width: 300,
        height: 40,
        prefixWidth: 50,
        totalBeats: 4,
        beatAnchors: [
          [0, 100],
          [4, 340],
        ],
      },
    ];

    const anchors = buildSlurAnchorPoints(makeScore(), spatialIndex, 0, bounds);

    expect(anchors[0]?.x).toBe(106);
    expect(anchors[0]?.endX).toBe(335);
  });
});

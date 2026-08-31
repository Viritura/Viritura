import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { DisplayList, SpatialIndex, StaffInfo } from "@viritura/renderer";
import { buildBeatMap, resolveStaffForCursor } from "../components/inputCursorHelpers";

const staves: StaffInfo[] = [
  { x: 0, xEnd: 400, y: 100, spatium: 10, height: 40, index: 0 },
  { x: 0, xEnd: 400, y: 200, spatium: 10, height: 40, index: 1 },
];

describe("tuplet input cursor geometry", () => {
  it("resolves the requested staff within a grand-staff part", () => {
    const displayList = {
      measureBounds: [
        { index: 0, partIndex: 0, staffIndex: 0, x: 0, width: 400, y: 100, height: 40 },
        { index: 0, partIndex: 0, staffIndex: 1, x: 0, width: 400, y: 200, height: 40 },
      ],
    } as unknown as DisplayList;

    expect(resolveStaffForCursor({ measureIndex: 0, partIndex: 0, staffIndex: 1 }, staves, displayList)?.index).toBe(1);
  });

  it("keeps tuplet onsets after a tremolo at their real beat positions", () => {
    const score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "tremolo",
                      marks: 3,
                      outer: { multiple: 1, duration: { base: "half" } },
                      content: [
                        { type: "event", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                        { type: "event", duration: { base: "half" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                      ],
                    },
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
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;
    const displayList = {
      measureBounds: [
        {
          index: 0,
          partIndex: 0,
          staffIndex: 0,
          x: 0,
          width: 400,
          y: 100,
          height: 40,
          prefixWidth: 0,
          totalBeats: 4,
          beatAnchors: [
            [0, 0],
            [4, 400],
          ],
        },
      ],
    } as unknown as DisplayList;

    const map = buildBeatMap(0, score, { all: [] } as unknown as SpatialIndex, 0, displayList, 0);
    const beats = map?.anchors.map((anchor) => anchor.beat) ?? [];
    expect(beats.some((beat) => Math.abs(beat - 2) < 1e-9)).toBe(true);
    expect(beats.some((beat) => Math.abs(beat - (2 + 1 / 3)) < 1e-9)).toBe(true);
    expect(beats.some((beat) => Math.abs(beat - (2 + 2 / 3)) < 1e-9)).toBe(true);
    expect(map?.anchors.some((anchor) => anchor.beat === 0.333)).toBe(false);
    expect(map?.anchors.find((anchor) => Math.abs(anchor.beat - (2 + 1 / 3)) < 1e-9)?.x).toBeCloseTo(233.333);
    expect(map?.anchors.find((anchor) => Math.abs(anchor.beat - (2 + 2 / 3)) < 1e-9)?.x).toBeCloseTo(266.667);
  });
});

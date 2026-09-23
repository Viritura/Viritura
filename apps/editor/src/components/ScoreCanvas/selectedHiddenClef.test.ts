import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { MeasureBounds } from "@viritura/renderer";
import { resolveSelectedHiddenClefOverlay } from "./selectedHiddenClef";

describe("resolveSelectedHiddenClefOverlay", () => {
  it("derives ghost geometry for a selected hidden mid-measure clef change", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              clefs: [
                { clef: { sign: "G", staffPosition: -2 } },
                { clef: { sign: "F", staffPosition: 2, hide: true }, position: { fraction: [1, 2] } },
              ],
              sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }],
            },
          ],
        },
      ],
    };
    const measureBounds: MeasureBounds[] = [
      {
        index: 0,
        partIndex: 0,
        staffIndex: 0,
        x: 100,
        width: 160,
        y: 100,
        height: 48,
        prefixWidth: 24,
        totalBeats: 4,
        beatAnchors: [
          [0, 112],
          [2, 160],
          [4, 220],
        ],
      },
    ];

    const overlay = resolveSelectedHiddenClefOverlay(
      score,
      {
        kind: "single",
        elementId: "p0/m0/clef1",
        elementType: "clef",
        measureAnchor: { partIndex: 0, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
      },
      measureBounds,
    );

    expect(overlay).toEqual({ x: 160, y: 112, codepoint: 0xe062, size: 48 });
  });
});

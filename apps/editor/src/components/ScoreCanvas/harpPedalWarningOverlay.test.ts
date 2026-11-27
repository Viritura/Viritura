import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { DisplayList, RenderCommand } from "@viritura/renderer";
import { harpPedalWarningGlyphs } from "./harpPedalWarningOverlay";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "harp",
        name: "Harp",
        staves: 2,
        _x: { viritura: { instrumentId: "pluck.harp" } },
        measures: [
          {
            harpPedals: [
              {
                id: "setting",
                position: { fraction: [0, 1] },
                tuning: { D: 0, C: 1, B: 0, E: 0, F: 0, G: 0, A: 0 },
              },
            ],
            sequences: [
              {
                staff: 1,
                content: [
                  {
                    type: "event",
                    id: "chord",
                    duration: { base: "whole" },
                    notes: [
                      { id: "c", pitch: { step: "C", octave: 4 } },
                      { id: "d", pitch: { step: "D", octave: 4 } },
                    ],
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

function glyph(x: number): RenderCommand {
  return { type: "DrawGlyph", x, y: 100, codepoint: 0xe0a4, size: 12, font: "Bravura", color: "#000000", rotation: 0 };
}

describe("harp pedal notehead warning overlay", () => {
  it("re-inks only the mismatched chord notehead", () => {
    const list: DisplayList = {
      commands: [glyph(10), glyph(30)],
      elementIds: ["p0/m0/s0/chord/n0", "p0/m0/s0/chord/n1"],
      width: 100,
      height: 100,
    };

    expect(harpPedalWarningGlyphs(score(), list, 1)).toEqual([{ ...glyph(10), color: "#d32f2f" }]);
  });

  it("refreshes rendered note identity when a display-list version changes", () => {
    const list: DisplayList = {
      commands: [glyph(10)],
      elementIds: ["p0/m0/s0/chord/n0"],
      width: 100,
      height: 100,
    };
    const currentScore = score();
    expect(harpPedalWarningGlyphs(currentScore, list, 1)).toHaveLength(1);
    list.elementIds = ["p0/m0/s0/chord/n1"];
    expect(harpPedalWarningGlyphs(currentScore, list, 2)).toHaveLength(0);
  });
});

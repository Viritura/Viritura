import { describe, it, expect } from "vitest";
import { buildLineToMeasureMap, lineToMeasure } from "../diff/lineToMeasure";

/** Simple MNX with 2 measures, 1 part. */
const SIMPLE_MNX = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }, {}],
    },
    parts: [
      {
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [
              {
                content: [
                  {
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 5 } }],
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
                    duration: { base: "half" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
);

/** MNX with 2 parts. */
const TWO_PART_MNX = JSON.stringify(
  {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 5 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "G", octave: 5 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
);

describe("buildLineToMeasureMap", () => {
  it("maps lines inside measures correctly for simple MNX", () => {
    const map = buildLineToMeasureMap(SIMPLE_MNX);
    const lines = SIMPLE_MNX.split("\n");

    // Find a line inside the first part measure (contains "clefs")
    const clefsLineIdx = lines.findIndex((l) => l.includes('"clefs"'));
    expect(clefsLineIdx).toBeGreaterThan(-1);
    const clefsLine = clefsLineIdx + 1; // 1-based
    const loc = lineToMeasure(map, clefsLine);
    expect(loc).not.toBeNull();
    expect(loc!.section).toBe("parts");
    expect(loc!.partIndex).toBe(0);
    expect(loc!.measureIndex).toBe(0);
  });

  it("maps lines in second measure correctly", () => {
    const map = buildLineToMeasureMap(SIMPLE_MNX);
    const lines = SIMPLE_MNX.split("\n");

    // Find a line inside the second measure (contains "half")
    const halfLineIdx = lines.findIndex((l) => l.includes('"half"'));
    expect(halfLineIdx).toBeGreaterThan(-1);
    const halfLine = halfLineIdx + 1;
    const loc = lineToMeasure(map, halfLine);
    expect(loc).not.toBeNull();
    expect(loc!.section).toBe("parts");
    expect(loc!.partIndex).toBe(0);
    expect(loc!.measureIndex).toBe(1);
  });

  it("maps global measures correctly", () => {
    const map = buildLineToMeasureMap(SIMPLE_MNX);
    const lines = SIMPLE_MNX.split("\n");

    // Find a line inside the global measure (contains "count")
    const countLineIdx = lines.findIndex((l) => l.includes('"count"'));
    expect(countLineIdx).toBeGreaterThan(-1);
    const countLine = countLineIdx + 1;
    const loc = lineToMeasure(map, countLine);
    expect(loc).not.toBeNull();
    expect(loc!.section).toBe("global");
    expect(loc!.measureIndex).toBe(0);
  });

  it("returns null for lines outside any measure", () => {
    const map = buildLineToMeasureMap(SIMPLE_MNX);
    // Line 1 is the opening brace - outside any measure
    expect(lineToMeasure(map, 1)).toBeNull();
  });

  it("handles two parts correctly", () => {
    const map = buildLineToMeasureMap(TWO_PART_MNX);
    const lines = TWO_PART_MNX.split("\n");

    // Find the line containing "Violin" pitch (G5)
    // It should be in part 1, measure 0
    const g5LineIdx = lines.findIndex((l) => l.includes('"G"') && l.includes('"step"'));
    if (g5LineIdx > -1) {
      const loc = lineToMeasure(map, g5LineIdx + 1);
      expect(loc).not.toBeNull();
      expect(loc!.section).toBe("parts");
      expect(loc!.partIndex).toBe(1);
      expect(loc!.measureIndex).toBe(0);
    }
  });

  it("returns null for out-of-range line numbers", () => {
    const map = buildLineToMeasureMap(SIMPLE_MNX);
    expect(lineToMeasure(map, 0)).toBeNull();
    expect(lineToMeasure(map, -1)).toBeNull();
    expect(lineToMeasure(map, 99999)).toBeNull();
  });

  it("handles empty text gracefully", () => {
    const map = buildLineToMeasureMap("");
    expect(map.length).toBeGreaterThan(0);
    expect(lineToMeasure(map, 1)).toBeNull();
  });

  it("handles invalid JSON gracefully", () => {
    const map = buildLineToMeasureMap("not valid json {{{");
    expect(lineToMeasure(map, 1)).toBeNull();
  });
});

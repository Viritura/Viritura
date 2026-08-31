import { describe, it, expect } from "vitest";
import { computeMeasureBounds, getMeasureCenterX, extractMeasureBounds } from "../diff/measureBounds";
import type { DisplayList } from "@viritura/renderer";

function makeDisplayList(
  commands: DisplayList["commands"],
  elementIds?: (string | null)[],
  width = 500,
  height = 200,
): DisplayList {
  const dl: DisplayList = {
    commands,
    width,
    height,
  };
  if (elementIds) {
    dl.elementIds = elementIds;
  }
  return dl;
}

describe("computeMeasureBounds", () => {
  it("computes bounds from element IDs", () => {
    const dl = makeDisplayList(
      [
        { type: "DrawRect", x: 10, y: 0, w: 50, h: 20, color: "#000" },
        { type: "DrawRect", x: 100, y: 0, w: 50, h: 20, color: "#000" },
        { type: "DrawRect", x: 200, y: 0, w: 50, h: 20, color: "#000" },
      ],
      ["p0/m0/clef", "p0/m0/s0/ev1", "p0/m1/s0/ev1"],
    );

    const bounds = computeMeasureBounds(dl);
    expect(bounds).toHaveLength(2);

    const m0 = bounds.find((b) => b.measureIndex === 0);
    expect(m0).toBeDefined();
    expect(m0!.xStart).toBe(10);
    expect(m0!.xEnd).toBe(150); // 100 + 50

    const m1 = bounds.find((b) => b.measureIndex === 1);
    expect(m1).toBeDefined();
    expect(m1!.xStart).toBe(200);
    expect(m1!.xEnd).toBe(250); // 200 + 50
  });

  it("returns empty array when no element IDs", () => {
    const dl = makeDisplayList([{ type: "DrawRect", x: 10, y: 0, w: 50, h: 20, color: "#000" }]);
    expect(computeMeasureBounds(dl)).toEqual([]);
  });

  it("handles global measure IDs (m0/time format)", () => {
    const dl = makeDisplayList(
      [{ type: "DrawGlyph", x: 30, y: 50, codepoint: 0xe050, font: "Bravura", size: 48, color: "#000", rotation: 0 }],
      ["m0/time"],
    );
    const bounds = computeMeasureBounds(dl);
    expect(bounds).toHaveLength(1);
    expect(bounds[0]!.measureIndex).toBe(0);
  });

  it("sorts bounds by measure index", () => {
    const dl = makeDisplayList(
      [
        { type: "DrawRect", x: 200, y: 0, w: 10, h: 10, color: "#000" },
        { type: "DrawRect", x: 10, y: 0, w: 10, h: 10, color: "#000" },
        { type: "DrawRect", x: 400, y: 0, w: 10, h: 10, color: "#000" },
      ],
      ["p0/m2/s0/ev1", "p0/m0/clef", "p0/m5/s0/ev1"],
    );
    const bounds = computeMeasureBounds(dl);
    expect(bounds.map((b) => b.measureIndex)).toEqual([0, 2, 5]);
  });
});

describe("getMeasureCenterX", () => {
  it("returns center of measure bounds", () => {
    const bounds = [
      { measureIndex: 0, xStart: 10, xEnd: 100, yStart: 0, yEnd: 200 },
      { measureIndex: 1, xStart: 110, xEnd: 250, yStart: 0, yEnd: 200 },
    ];
    expect(getMeasureCenterX(bounds, 0)).toBe(55);
    expect(getMeasureCenterX(bounds, 1)).toBe(180);
  });

  it("returns null for non-existent measure", () => {
    const bounds = [{ measureIndex: 0, xStart: 10, xEnd: 100, yStart: 0, yEnd: 200 }];
    expect(getMeasureCenterX(bounds, 5)).toBeNull();
  });

  it("returns null for empty bounds", () => {
    expect(getMeasureCenterX([], 0)).toBeNull();
  });
});

describe("extractMeasureBounds", () => {
  it("returns uniform bounds when no element IDs available", () => {
    const dl = makeDisplayList([], undefined, 800, 200);
    const bounds = extractMeasureBounds(dl, 4);
    expect(bounds).toHaveLength(4);
    expect(bounds[0].measureIndex).toBe(0);
    expect(bounds[3].measureIndex).toBe(3);
    // Each should span roughly 1/4 of the usable width
    expect(bounds[0].xStart).toBeLessThan(bounds[1].xStart);
    expect(bounds[1].xStart).toBeLessThan(bounds[2].xStart);
  });

  it("returns empty for zero measures", () => {
    const dl = makeDisplayList([], undefined, 800, 200);
    const bounds = extractMeasureBounds(dl, 0);
    expect(bounds).toHaveLength(0);
  });

  it("extracts bounds from element IDs", () => {
    const dl = makeDisplayList(
      [
        { type: "DrawGlyph", x: 50, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
        { type: "DrawGlyph", x: 120, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
        { type: "DrawGlyph", x: 300, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
        { type: "DrawGlyph", x: 400, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
      ],
      ["p0/m0/s0/ev1", "p0/m0/s0/ev2", "p0/m1/s0/ev1", "p0/m1/s0/ev2"],
      800,
      200,
    );
    const bounds = extractMeasureBounds(dl, 2);
    expect(bounds).toHaveLength(2);
    expect(bounds[0].measureIndex).toBe(0);
    expect(bounds[1].measureIndex).toBe(1);
    // Measure 0 should start around x=50, measure 1 around x=300
    expect(bounds[0].xStart).toBeLessThanOrEqual(50);
    expect(bounds[1].xStart).toBeLessThanOrEqual(300);
    // Measure 0 should end before measure 1 starts
    expect(bounds[0].xEnd).toBeLessThan(bounds[1].xStart);
  });

  it("handles mixed element IDs with null entries", () => {
    const dl = makeDisplayList(
      [
        { type: "DrawLine", x1: 10, y1: 50, x2: 10, y2: 100, width: 1, color: "#000" },
        { type: "DrawGlyph", x: 80, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
        { type: "DrawGlyph", x: 200, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
      ],
      [null, "p0/m0/clef", "p0/m1/s0/ev1"],
      600,
      200,
    );
    const bounds = extractMeasureBounds(dl, 2);
    expect(bounds).toHaveLength(2);
    expect(bounds[0].measureIndex).toBe(0);
    expect(bounds[1].measureIndex).toBe(1);
  });

  it("parses measure index from various element ID formats", () => {
    const dl = makeDisplayList(
      [
        { type: "DrawGlyph", x: 50, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
        { type: "DrawGlyph", x: 200, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
        { type: "DrawGlyph", x: 400, y: 100, codepoint: 0xe050, font: "Bravura", size: 20, color: "#000", rotation: 0 },
      ],
      ["p0/m0/clef", "p0/m2/key", "m5/time"],
      800,
      200,
    );
    const bounds = extractMeasureBounds(dl, 6);
    expect(bounds.map((b) => b.measureIndex)).toEqual([0, 2, 5]);
  });
});

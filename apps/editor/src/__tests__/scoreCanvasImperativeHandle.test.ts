import { describe, expect, it } from "vitest";
import type { DisplayList, MeasureBounds } from "@viritura/renderer";

import { centeredScrollPosition, measureVisualPosition } from "../components/ScoreCanvas/imperativeHandle";

function measure(index: number, x: number, y: number): MeasureBounds {
  return {
    index,
    partIndex: 0,
    staffIndex: 0,
    x,
    y,
    width: 200,
    height: 48,
    prefixWidth: 0,
    totalBeats: 4,
    beatAnchors: [],
  };
}

const displayList: DisplayList = {
  commands: [],
  width: 600,
  height: 1800,
  pages: [
    { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 800 },
    { pageNumber: 2, systemIndices: [1], yOffset: 1000, height: 800 },
  ],
  measureBounds: [measure(124, 150, 1100)],
};

describe("measureVisualPosition", () => {
  it("uses engine coordinates in Horizon view", () => {
    expect(measureVisualPosition(displayList, 124, "horizon")).toEqual({ x: 250, y: 1124 });
  });

  describe("centeredScrollPosition", () => {
    it("centers the target in the visible canvas area", () => {
      expect(centeredScrollPosition({ x: 900, y: 600 }, 600, 400)).toEqual({ x: 600, y: 400 });
    });

    it("clamps near-origin targets without negative scrolling", () => {
      expect(centeredScrollPosition({ x: 100, y: 80 }, 600, 400)).toEqual({ x: 0, y: 0 });
    });
  });

  it("accounts for the page-stack gap in Page view", () => {
    expect(measureVisualPosition(displayList, 124, "page")).toEqual({ x: 250, y: 1204 });
  });

  it("accounts for page placement in vertical Spread view", () => {
    expect(measureVisualPosition(displayList, 124, "spread")).toEqual({ x: 250, y: 1004 });
  });

  it("returns null when the measure is not in the current display list", () => {
    expect(measureVisualPosition(displayList, 999, "page")).toBeNull();
  });
});

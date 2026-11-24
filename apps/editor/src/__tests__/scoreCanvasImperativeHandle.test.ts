import { describe, expect, it, vi } from "vitest";
import type { DisplayList, MeasureBounds } from "@viritura/renderer";

import {
  buildScoreCanvasHandle,
  centeredScrollPosition,
  fitScoreView,
  measureVisualPosition,
} from "../components/ScoreCanvas/imperativeHandle";
import { clickFollowScroll, clickFrameClip } from "../components/ScoreCanvas/clickViewport";

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

describe("current viewport page", () => {
  it.each([
    { viewMode: "page" as const, scrollX: 0, scrollY: 1100, expected: 1 },
    { viewMode: "spread" as const, scrollX: 0, scrollY: 900, expected: 1 },
    { viewMode: "spread-h" as const, scrollX: 1320, scrollY: 0, expected: 1 },
    { viewMode: "horizon" as const, scrollX: 1320, scrollY: 1100, expected: 0 },
  ])("uses the displayed page geometry in $viewMode", ({ viewMode, scrollX, scrollY, expected }) => {
    const container = document.createElement("div");
    Object.defineProperties(container, { clientWidth: { value: 400 }, clientHeight: { value: 200 } });
    const handle = buildScoreCanvasHandle({
      setZoom: () => {},
      setScroll: () => {},
      restoreViewport: () => {},
      resetViewport: () => {},
      scoreDefinitions: [],
      selectedScoreIndex: 0,
      viewport: { zoom: 2, scrollX, scrollY },
      displayListRef: { current: displayList },
      spatialIndexRef: { current: null },
      canvasRef: { current: null },
      containerRef: { current: container },
      docScoreRef: { current: null },
      viewMode,
    });
    expect(handle.getCurrentPageIndex()).toBe(expected);
  });
});

describe("view fitting", () => {
  function fit(layout: DisplayList, viewMode: "page" | "spread" | "spread-h" | "horizon", scrollX = 0, scrollY = 0) {
    const container = document.createElement("div");
    Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const setZoom = vi.fn();
    const setScroll = vi.fn();
    fitScoreView({
      displayList: layout,
      container,
      viewport: { zoom: 1, scrollX, scrollY },
      viewMode,
      setZoom,
      setScroll,
      safeArea: { top: 12, bottom: 60 },
    });
    return { setZoom, setScroll };
  }

  it("fits Horizon height without shrinking to the full strip width or requiring pages", () => {
    const { setZoom, setScroll } = fit({ commands: [], width: 50000, height: 400 }, "horizon", 3000);
    expect(setZoom).toHaveBeenCalledWith(1.2);
    expect(setScroll).toHaveBeenCalledWith(3000, -30);
  });

  it("fits a single page rather than the full page stack", () => {
    expect(fit(displayList, "page").setZoom).toHaveBeenCalledWith(0.6);
  });

  it.each(["spread", "spread-h"] as const)("fits the current paired frame in %s", (mode) => {
    const layout: DisplayList = {
      ...displayList,
      pages: [...displayList.pages!, { pageNumber: 3, systemIndices: [2], yOffset: 2000, height: 800 }],
    };
    const { setZoom, setScroll } = fit(layout, mode, mode === "spread-h" ? 1320 : 0, mode === "spread" ? 880 : 0);
    expect(setZoom).toHaveBeenCalledWith(0.6);
    const [x, y] = setScroll.mock.calls[0]!;
    expect(x).toBeCloseTo(mode === "spread-h" ? 1253.3333 : -66.6667);
    expect(y).toBeCloseTo(mode === "spread" ? 820 : -60);
  });

  it.each(["spread", "spread-h"] as const)("reserves space for two pages on the opening %s frame", (mode) => {
    const { setZoom } = fit(displayList, mode);
    expect(setZoom).toHaveBeenCalledWith(0.6);
  });

  it.each(["page", "spread", "spread-h"] as const)("centers the selected %s frame", (viewMode) => {
    const layout: DisplayList = {
      ...displayList,
      pages: [...displayList.pages!, { pageNumber: 3, systemIndices: [2], yOffset: 2000, height: 800 }],
    };
    const result = clickFollowScroll({
      displayList: layout,
      position: { measureIndex: 124, beat: 0 },
      page: 1,
      viewMode,
      viewport: { zoom: 0.6, scrollX: 0, scrollY: 0 },
      width: 800,
      height: 600,
      safeArea: { top: 12, bottom: 60 },
    });
    expect(result).not.toBeNull();
    const frameCenterX = viewMode === "page" ? 300 : viewMode === "spread" ? 600 : 1920;
    const frameCenterY = viewMode === "spread-h" ? 400 : viewMode === "spread" ? 1280 : 1480;
    expect((frameCenterX - result!.x) * 0.6).toBeCloseTo(400);
    expect((frameCenterY - result!.y) * 0.6).toBeCloseTo(276);
  });

  it("clips both axes to a centered page frame within the safe area", () => {
    expect(
      clickFrameClip({ width: 400, height: 300 }, 1000, 800, 1, {
        left: 20,
        right: 40,
        top: 10,
        bottom: 30,
      }),
    ).toBe("inset(240px 310px 260px 290px)");
    expect(clickFrameClip({ width: 1200, height: 1000 }, 1000, 800, 1)).toBe("inset(0px 0px 0px 0px)");
  });
});

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

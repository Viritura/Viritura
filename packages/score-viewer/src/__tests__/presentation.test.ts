import { describe, expect, it } from "vitest";
import { arrangePages } from "../pageArrangement";
import { fitZoom } from "../zoom";
import { followOffset } from "../playheadFollow";
import { needsArrangement, needsLayout } from "../presentationChanges";
import type { ScoreViewMode } from "../types";

const pages = [
  { width: 100, height: 180, offsetY: 0 },
  { width: 100, height: 200, offsetY: 180 },
  { width: 100, height: 160, offsetY: 380 },
];

describe("page arrangements", () => {
  it.each([
    ["page", [0, 0, 0], [0, 196, 412]],
    ["horizontal", [0, 116, 232], [0, 0, 0]],
    ["spread", [58, 0, 116], [0, 196, 196]],
    ["spread-horizontal", [58, 232, 348], [0, 0, 0]],
    ["horizon", [0, 0, 0], [0, 180, 380]],
  ] as const)("%s", (viewMode, xs, ys) => {
    const result = arrangePages({ pages, viewMode: viewMode as ScoreViewMode, zoom: 1, gap: 16 });
    expect(result.positions.map((page) => page.x)).toEqual(xs);
    expect(result.positions.map((page) => page.y)).toEqual(ys);
  });

  it("supports page columns and paired first spread", () => {
    expect(
      arrangePages({ pages, viewMode: "page", zoom: 1, gap: 16, pagesPerRow: 2 }).positions.map((page) => page.y),
    ).toEqual([0, 0, 216]);
    expect(
      arrangePages({ pages, viewMode: "spread", zoom: 1, gap: 16, spreadFirstPage: "paired" }).positions.map(
        (page) => page.x,
      ),
    ).toEqual([0, 116, 58]);
  });
});

describe("zoom and follow", () => {
  it("fits width or full page with available viewport padding", () => {
    expect(fitZoom("fit-width", { width: 448, height: 248 }, pages[0]!, "spread", 16)).toBeCloseTo(400 / 216);
    expect(fitZoom("fit-page", { width: 448, height: 248 }, pages[0]!, "page", 16)).toBeCloseTo(200 / 180);
  });

  describe("presentation updates", () => {
    it("reflows only when layout inputs change, not when margins are recreated", () => {
      const margins = { top: 12, right: 12, bottom: 12, left: 12 };
      expect(needsLayout({ pageMargins: margins }, { pageMargins: { ...margins } })).toBe(false);
      expect(needsLayout({ pageMargins: margins }, { pageMargins: { ...margins, left: 20 } })).toBe(true);
      expect(needsLayout({ viewMode: "page" }, { viewMode: "horizon" })).toBe(true);
    });
    it("rearranges for zoom and repaints for ink updates", () => {
      expect(needsArrangement({ zoom: 1 }, { zoom: 2 })).toBe(true);
      expect(needsArrangement({ ink: "#000" }, { ink: "#fff" })).toBe(true);
      expect(needsArrangement({ pageBackground: "#fff" }, { pageBackground: "#fff" })).toBe(false);
    });
  });
  it("follows only when the cursor leaves the viewport", () => {
    expect(followOffset(120, 10, 100, 200, 0.5)).toBe(100);
    expect(followOffset(320, 10, 100, 200, 0.5)).toBe(220);
    expect(followOffset(5, 10, 100, 200, 0.5)).toBe(0);
  });
});

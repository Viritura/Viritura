import { describe, expect, it } from "vitest";
import { layoutOptionsFor } from "../layoutRequest";
import { arrangePages, contentOffset, pageFrame, pageFrameGap } from "../pageArrangement";
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

  it.each(["spread", "spread-horizontal"] as const)(
    "%s keeps the recto title separate from subsequent verso/recto frames",
    (viewMode) => {
      const result = arrangePages({
        pages: [...pages, pages[0]!, pages[1]!],
        viewMode,
        zoom: 1,
        gap: 16,
        frameGap: 184,
        spreadFirstPage: "single",
      });
      expect(pageFrame(result.positions, 0, viewMode, "single")).toEqual({
        x: result.positions[0]!.x,
        y: result.positions[0]!.y,
        width: 100,
        height: 180,
      });
      for (const left of [1, 3]) {
        const verso = result.positions[left]!;
        const recto = result.positions[left + 1]!;
        expect(verso.y).toBe(recto.y);
        expect(recto.x).toBe(verso.x + verso.width + 16);
        expect(pageFrame(result.positions, left, viewMode, "single")).toEqual(
          pageFrame(result.positions, left + 1, viewMode, "single"),
        );
        expect(pageFrame(result.positions, left, viewMode, "single")?.width).toBe(216);
      }
      expect(pageFrame(result.positions, 1, viewMode, "single")).not.toEqual(
        pageFrame(result.positions, 0, viewMode, "single"),
      );
    },
  );

  it("centres content that fits and keeps oversized axes at the start", () => {
    const viewport = { width: 400, height: 300 };
    expect(contentOffset(undefined, viewport, { width: 100, height: 100 })).toEqual({ x: 0, y: 0 });
    expect(contentOffset("center", viewport, { width: 100, height: 100 })).toEqual({ x: 150, y: 100 });
    expect(contentOffset("center", viewport, { width: 100, height: 900 })).toEqual({ x: 150, y: 0 });
  });

  it("separates fitted spreads into viewport-sized frames and centers a final unpaired page", () => {
    expect(pageFrameGap(pages, 1, 16, "spread-horizontal", { width: 400, height: 300 })).toBe(184);
    const result = arrangePages({
      pages,
      viewMode: "spread-horizontal",
      zoom: 1,
      gap: 16,
      frameGap: 184,
      spreadFirstPage: "paired",
    });
    expect(result.positions.map((page) => page.x)).toEqual([0, 116, 458]);
    expect(pageFrame(result.positions, 0, "spread-horizontal", "paired")).toEqual({
      x: 0,
      y: 0,
      width: 216,
      height: 200,
    });
    expect(pageFrame(result.positions, 1, "spread-horizontal", "paired")).toEqual(
      pageFrame(result.positions, 0, "spread-horizontal", "paired"),
    );
    expect(pageFrame(result.positions, 2, "spread-horizontal", "paired")).toEqual({
      x: 458,
      y: 0,
      width: 100,
      height: 160,
    });
    expect(pageFrame(result.positions, 3, "spread-horizontal", "paired")).toBeUndefined();
  });
});

describe("zoom and follow", () => {
  it("fits width or full page with available viewport padding", () => {
    expect(fitZoom("fit-width", { width: 448, height: 248 }, pages[0]!, "spread", 16)).toBeCloseTo(384 / 200);
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
      expect(needsArrangement({}, { contentAlign: "center" })).toBe(true);
    });
  });
  it("follows only when the cursor leaves the viewport", () => {
    expect(followOffset(120, 10, 100, 200, 0.5)).toBe(100);
    expect(followOffset(320, 10, 100, 200, 0.5)).toBe(220);
    expect(followOffset(5, 10, 100, 200, 0.5)).toBe(0);
  });
});

describe("layoutOptionsFor", () => {
  const margins = { top: 10, right: 20, bottom: 30, left: 40 };

  it("lays page views out with default A4 geometry", () => {
    expect(layoutOptionsFor({ viewMode: "page", pageWidth: 210 })).toEqual({
      pageWidth: 210,
      spatium: 7,
      scoreIndex: 0,
      pageSetup: { height: 297, margins: { top: 15, right: 15, bottom: 15, left: 15 } },
    });
  });

  it("leaves horizon margins to the engine unless the caller sets them", () => {
    expect(layoutOptionsFor({ viewMode: "horizon" }).pageSetup).toBeUndefined();
    const opts = layoutOptionsFor({ viewMode: "horizon", pageWidth: 210, pageMargins: margins });
    expect(opts.pageWidth).toBe(0);
    expect(opts.pageSetup).toEqual({ height: 297, margins });
  });
});

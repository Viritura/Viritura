import { describe, it, expect } from "vitest";
import type { DisplayList } from "@viritura/renderer";
import {
  computePagePlacements,
  placementCommandOffset,
  visualToEngineCoords,
  SPREAD_ROW_GAP,
  PAGE_STACK_GAP,
} from "../components/ScoreCanvas/viewportGeometry";

const PAGE_W = 800;

/** Build a display list with `n` pages laid out vertically in engine coords. */
function makeDisplayList(heights: number[]): DisplayList {
  let yOffset = 0;
  const pages = heights.map((height, i) => {
    const page = { pageNumber: i + 1, systemIndices: [], yOffset, height };
    yOffset += height; // engine pages stack tight (no gap) at their yOffset
    return page;
  });
  return {
    commands: [],
    width: PAGE_W,
    height: yOffset,
    pages,
  };
}

describe("computePagePlacements", () => {
  it("returns [] for horizon (one continuous galley)", () => {
    const dl = makeDisplayList([1000, 1000]);
    expect(computePagePlacements(dl, "horizon")).toEqual([]);
  });

  it("returns [] when the display list has no page metadata", () => {
    const dl: DisplayList = { commands: [], width: PAGE_W, height: 1000 };
    expect(computePagePlacements(dl, "page")).toEqual([]);
    expect(computePagePlacements(dl, "spread")).toEqual([]);
    expect(computePagePlacements(dl, "spread-h")).toEqual([]);
  });

  describe("page view (vertical stack)", () => {
    it("stacks pages with PAGE_STACK_GAP between them", () => {
      const dl = makeDisplayList([1000, 1200, 900]);
      const placements = computePagePlacements(dl, "page");
      // x is always 0 in page view; y = engine yOffset + i * gap.
      expect(placements.map((p) => p.x)).toEqual([0, 0, 0]);
      expect(placements[0]!.y).toBe(0); // yOffset 0 + 0*gap
      expect(placements[1]!.y).toBe(1000 + 1 * PAGE_STACK_GAP); // yOffset 1000 + gap
      expect(placements[2]!.y).toBe(2200 + 2 * PAGE_STACK_GAP); // yOffset 2200 + 2*gap
    });

    it("command offset cancels the engine yOffset, leaving i*gap", () => {
      const dl = makeDisplayList([1000, 1200]);
      const placements = computePagePlacements(dl, "page");
      expect(placementCommandOffset(placements[0]!)).toEqual({ dx: 0, dy: 0 });
      expect(placementCommandOffset(placements[1]!)).toEqual({ dx: 0, dy: PAGE_STACK_GAP });
    });
  });

  describe("spread view (book fold, vertical rows)", () => {
    it("opens page 0 on the right (recto) and pairs subsequent pages left/right", () => {
      const dl = makeDisplayList([1000, 1000, 1000, 1000, 1000]);
      const placements = computePagePlacements(dl, "spread");
      // Page 0 alone on the right; pages 1/2 a row; pages 3/4 next row.
      expect(placements[0]!.x).toBe(PAGE_W); // recto (right)
      expect(placements[1]!.x).toBe(0); // verso (left)
      expect(placements[2]!.x).toBe(PAGE_W); // recto (right)
      expect(placements[3]!.x).toBe(0);
      expect(placements[4]!.x).toBe(PAGE_W);
    });

    it("advances row Y after the cover and after each right page", () => {
      const dl = makeDisplayList([1000, 1000, 1000]);
      const placements = computePagePlacements(dl, "spread");
      const row0 = 0;
      const row1 = 1000 + SPREAD_ROW_GAP;
      expect(placements[0]!.y).toBe(row0); // cover row
      expect(placements[1]!.y).toBe(row1); // pair row (left)
      expect(placements[2]!.y).toBe(row1); // pair row (right) — same row
    });
  });

  describe("spread-h view (horizontal spreads)", () => {
    it("places page 0 on the right then advances horizontally per spread", () => {
      const dl = makeDisplayList([1000, 1000, 1000]);
      const placements = computePagePlacements(dl, "spread-h");
      // All pages share y=0 (single horizontal band).
      expect(placements.every((p) => p.y === 0)).toBe(true);
      expect(placements[0]!.x).toBe(PAGE_W); // cover on right of first spread
      expect(placements[1]!.x).toBeGreaterThan(0); // next spread, left page
      expect(placements[2]!.x).toBeGreaterThan(placements[1]!.x); // right of next spread
    });
  });
});

describe("visualToEngineCoords round-trips through placements", () => {
  it("inverts the spread placement transform for a point inside a page", () => {
    const dl = makeDisplayList([1000, 1000, 1000]);
    const placements = computePagePlacements(dl, "spread");
    // Pick page 2 (right page of the pair) and a point 30px into it.
    const p = placements[2]!;
    const { dx, dy } = placementCommandOffset(p);
    const visualX = p.x + 30;
    const visualY = p.y + 40;
    const eng = visualToEngineCoords(visualX, visualY, dl, "spread");
    expect(eng).not.toBeNull();
    expect(eng!.engineX).toBe(visualX - dx);
    expect(eng!.engineY).toBe(visualY - dy);
    // Engine X is page-local; engine Y lands within the page's engine band.
    expect(eng!.engineX).toBe(30);
    expect(eng!.engineY).toBe(p.engineYOffset + 40);
  });

  it("returns null for a point outside every page in spread view", () => {
    const dl = makeDisplayList([1000, 1000]);
    // Far below all pages.
    expect(visualToEngineCoords(50, 999_999, dl, "spread")).toBeNull();
  });

  it("identity in horizon view", () => {
    const dl = makeDisplayList([1000, 1000]);
    expect(visualToEngineCoords(123, 456, dl, "horizon")).toEqual({ engineX: 123, engineY: 456 });
  });

  it("maps multi-page page view Y back through the stack gap", () => {
    const dl = makeDisplayList([1000, 1000]);
    const placements = computePagePlacements(dl, "page");
    const p = placements[1]!;
    const visualY = p.y + 25;
    const eng = visualToEngineCoords(10, visualY, dl, "page");
    expect(eng).not.toBeNull();
    expect(eng!.engineX).toBe(10);
    expect(eng!.engineY).toBe(p.engineYOffset + 25);
  });
});

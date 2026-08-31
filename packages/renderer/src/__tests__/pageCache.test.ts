import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PageCache, splitCommandsByPage } from "../pageCache";
import type { DisplayList, RenderCommand, PageLayout } from "../wasm";

// Mock OffscreenCanvas for Node/Vitest environment
function createMockOffscreenCtx(): OffscreenCanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    closePath: vi.fn(),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    measureText: vi.fn().mockReturnValue({
      width: 20,
      actualBoundingBoxLeft: 2,
      actualBoundingBoxRight: 18,
      actualBoundingBoxAscent: 30,
      actualBoundingBoxDescent: 5,
    }),
  } as unknown as OffscreenCanvasRenderingContext2D;
}

const origOffscreenCanvas = globalThis.OffscreenCanvas;
let latestOffscreenCtx: OffscreenCanvasRenderingContext2D;
beforeEach(() => {
  globalThis.OffscreenCanvas = vi.fn().mockImplementation(function (w: number, h: number) {
    const ctx = createMockOffscreenCtx();
    latestOffscreenCtx = ctx;
    return {
      width: w,
      height: h,
      getContext: vi.fn().mockReturnValue(ctx),
    };
  }) as unknown as typeof OffscreenCanvas;
});

afterAll(() => {
  globalThis.OffscreenCanvas = origOffscreenCanvas;
});

function createMockCtx(): CanvasRenderingContext2D {
  return {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    closePath: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

function makeDisplayList(commands: RenderCommand[], pages?: PageLayout[]): DisplayList {
  const totalHeight = pages ? pages.reduce((h, p) => Math.max(h, p.yOffset + p.height), 0) : 600;
  const dl: DisplayList = {
    commands,
    width: 800,
    height: totalHeight,
  };
  if (pages) {
    dl.pages = pages;
  }
  return dl;
}

describe("splitCommandsByPage", () => {
  it("should treat entire list as one page when no pages metadata", () => {
    const dl = makeDisplayList([{ type: "DrawRect", x: 0, y: 0, w: 100, h: 50, color: "#000" }]);
    const result = splitCommandsByPage(dl);
    expect(result).toHaveLength(1);
    expect(result[0]!.commands).toHaveLength(1);
  });

  it("should split commands into correct pages based on y coordinate", () => {
    const pages: PageLayout[] = [
      { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 300 },
      { pageNumber: 2, systemIndices: [1], yOffset: 300, height: 300 },
    ];

    const commands: RenderCommand[] = [
      { type: "DrawRect", x: 0, y: 100, w: 100, h: 50, color: "#000" },
      { type: "DrawRect", x: 0, y: 400, w: 100, h: 50, color: "#000" },
    ];

    const dl = makeDisplayList(commands, pages);
    const result = splitCommandsByPage(dl);
    expect(result).toHaveLength(2);
    expect(result[0]!.commands).toHaveLength(1);
    expect(result[1]!.commands).toHaveLength(1);
  });

  it("should handle DrawGlyph y-coordinate for page assignment", () => {
    const pages: PageLayout[] = [
      { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 500 },
      { pageNumber: 2, systemIndices: [1], yOffset: 500, height: 500 },
    ];

    const commands: RenderCommand[] = [
      {
        type: "DrawGlyph",
        x: 10,
        y: 250,
        codepoint: 0xe050,
        font: "Bravura",
        size: 40,
        color: "#000",
        rotation: 0,
      },
      {
        type: "DrawGlyph",
        x: 10,
        y: 750,
        codepoint: 0xe0a4,
        font: "Bravura",
        size: 40,
        color: "#000",
        rotation: 0,
      },
    ];

    const dl = makeDisplayList(commands, pages);
    const result = splitCommandsByPage(dl);
    expect(result[0]!.commands).toHaveLength(1);
    expect(result[1]!.commands).toHaveLength(1);
  });

  it("should assign line commands based on minimum y", () => {
    const pages: PageLayout[] = [
      { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 300 },
      { pageNumber: 2, systemIndices: [1], yOffset: 300, height: 300 },
    ];

    const commands: RenderCommand[] = [
      {
        type: "DrawLine",
        x1: 0,
        y1: 100,
        x2: 100,
        y2: 200,
        width: 1,
        color: "#000",
      },
    ];

    const dl = makeDisplayList(commands, pages);
    const result = splitCommandsByPage(dl);
    expect(result[0]!.commands).toHaveLength(1);
    expect(result[1]!.commands).toHaveLength(0);
  });
});

describe("PageCache", () => {
  it("should start with 0 pages", () => {
    const cache = new PageCache();
    expect(cache.pageCount).toBe(0);
    expect(cache.cachedPageCount).toBe(0);
  });

  it("should set display list and report page count", () => {
    const cache = new PageCache();
    const pages: PageLayout[] = [
      { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 300 },
      { pageNumber: 2, systemIndices: [1], yOffset: 300, height: 300 },
    ];
    const dl = makeDisplayList([{ type: "DrawRect", x: 0, y: 100, w: 50, h: 50, color: "#000" }], pages);
    cache.setDisplayList(dl);
    expect(cache.pageCount).toBe(2);
  });

  it("should cache pages within the 5-page window", () => {
    const cache = new PageCache();
    cache.setPaintFn(vi.fn());

    const pages: PageLayout[] = Array.from({ length: 10 }, (_, i) => ({
      pageNumber: i + 1,
      systemIndices: [i],
      yOffset: i * 300,
      height: 300,
    }));

    const commands: RenderCommand[] = pages.map((p) => ({
      type: "DrawRect" as const,
      x: 0,
      y: p.yOffset + 50,
      w: 100,
      h: 50,
      color: "#000",
    }));

    const dl = makeDisplayList(commands, pages);
    cache.setDisplayList(dl);
    cache.ensureWindow(2);

    // Window: pages 0,1,2,3,4
    expect(cache.isPageCached(0)).toBe(true);
    expect(cache.isPageCached(1)).toBe(true);
    expect(cache.isPageCached(2)).toBe(true);
    expect(cache.isPageCached(3)).toBe(true);
    expect(cache.isPageCached(4)).toBe(true);
    expect(cache.isPageCached(5)).toBe(false);
    expect(cache.cachedPageCount).toBe(5);
  });

  it("should preserve rounded finite-width tips for cached filled beziers", () => {
    const cache = new PageCache();
    const curve: RenderCommand = {
      type: "DrawFilledBezier",
      x1: 20,
      y1: 50,
      x2: 100,
      y2: 50,
      ocx1: 40,
      ocy1: 40,
      ocx2: 80,
      ocy2: 40,
      icx1: 40,
      icy1: 45,
      icx2: 80,
      icy2: 45,
      ix1: 20,
      iy1: 49,
      ix2: 100,
      iy2: 49,
      color: "#000",
      line_style: 0,
    };
    cache.setDisplayList(makeDisplayList([curve]));

    cache.ensureWindow(0);

    expect(latestOffscreenCtx.quadraticCurveTo).toHaveBeenCalledTimes(2);
    expect(latestOffscreenCtx.bezierCurveTo).toHaveBeenCalledTimes(2);
  });

  it("should evict pages outside the window when scrolling", () => {
    const cache = new PageCache();
    cache.setPaintFn(vi.fn());

    const pages: PageLayout[] = Array.from({ length: 10 }, (_, i) => ({
      pageNumber: i + 1,
      systemIndices: [i],
      yOffset: i * 300,
      height: 300,
    }));

    const commands: RenderCommand[] = pages.map((p) => ({
      type: "DrawRect" as const,
      x: 0,
      y: p.yOffset + 50,
      w: 100,
      h: 50,
      color: "#000",
    }));

    const dl = makeDisplayList(commands, pages);
    cache.setDisplayList(dl);

    // First, cache around page 0
    cache.ensureWindow(0);
    expect(cache.isPageCached(0)).toBe(true);

    // Scroll to page 5
    cache.ensureWindow(5);

    // Pages 0,1 should be evicted; pages 3-7 should be cached
    expect(cache.isPageCached(0)).toBe(false);
    expect(cache.isPageCached(1)).toBe(false);
    expect(cache.isPageCached(3)).toBe(true);
    expect(cache.isPageCached(5)).toBe(true);
    expect(cache.isPageCached(7)).toBe(true);
    expect(cache.cachedPageCount).toBe(5);
  });

  it("should invalidate all cached pages", () => {
    const cache = new PageCache();
    cache.setPaintFn(vi.fn());

    const pages: PageLayout[] = [{ pageNumber: 1, systemIndices: [0], yOffset: 0, height: 300 }];
    const dl = makeDisplayList([{ type: "DrawRect", x: 0, y: 50, w: 50, h: 50, color: "#000" }], pages);
    cache.setDisplayList(dl);
    cache.ensureWindow(0);
    expect(cache.cachedPageCount).toBe(1);

    cache.invalidate();
    expect(cache.cachedPageCount).toBe(0);
  });

  it("should composite cached pages to canvas", () => {
    const cache = new PageCache();
    cache.setPaintFn(vi.fn());

    const pages: PageLayout[] = [
      { pageNumber: 1, systemIndices: [0], yOffset: 0, height: 300 },
      { pageNumber: 2, systemIndices: [1], yOffset: 300, height: 300 },
    ];
    const commands: RenderCommand[] = [
      { type: "DrawRect", x: 0, y: 50, w: 50, h: 50, color: "#000" },
      { type: "DrawRect", x: 0, y: 350, w: 50, h: 50, color: "#000" },
    ];
    const dl = makeDisplayList(commands, pages);
    cache.setDisplayList(dl);
    cache.ensureWindow(0);

    const ctx = createMockCtx();
    cache.compositeToCanvas(ctx, 800, 600);

    // Should clear and draw cached pages via drawImage
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("should handle single page without pages metadata", () => {
    const cache = new PageCache();
    cache.setPaintFn(vi.fn());

    const dl: DisplayList = {
      commands: [{ type: "DrawRect", x: 0, y: 50, w: 50, h: 50, color: "#000" }],
      width: 800,
      height: 600,
    };
    cache.setDisplayList(dl);
    expect(cache.pageCount).toBe(1);

    cache.ensureWindow(0);
    expect(cache.isPageCached(0)).toBe(true);
  });
});

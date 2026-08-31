import { describe, it, expect } from "vitest";
import { clampZoom, clampScroll, restScroll, zoomAtPoint, MIN_ZOOM, MAX_ZOOM, type ViewportState } from "../viewport";

describe("clampZoom", () => {
  it("returns zoom unchanged when within range", () => {
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(0.5)).toBe(0.5);
  });

  it("clamps to MIN_ZOOM when zoom is too small", () => {
    expect(clampZoom(0.1)).toBe(0.1); // 0.1 is within range (MIN_ZOOM ≈ 0.0315 = 10% life size)
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-1)).toBe(MIN_ZOOM);
  });

  it("clamps to MAX_ZOOM when zoom is too large", () => {
    expect(clampZoom(5.0)).toBe(MAX_ZOOM); // 5.0 > MAX_ZOOM ≈ 3.15 (1000% life size)
    expect(clampZoom(100)).toBe(MAX_ZOOM);
  });

  it("returns exact boundary values", () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });
});

describe("clampScroll", () => {
  it("allows free scroll within overscroll bounds when content fits in viewport", () => {
    // Content 500px, viewport 800px at zoom 1 → minVisible = min(500*0.1, 20) = 20
    //   minScroll = -(800 - 20) = -780; maxScroll = 500 - 20 = 480
    // Scroll values within that range are preserved (no snap-to-center).
    expect(clampScroll(0, 500, 800, 1.0)).toBe(0);
    expect(clampScroll(100, 500, 800, 1.0)).toBe(0);
    expect(clampScroll(-200, 500, 800, 1.0)).toBe(-200);
  });

  it("allows negative scroll within bounds", () => {
    // minScroll = -(400 - 20) = -380, so -50 is within range
    expect(clampScroll(-50, 1000, 400, 1.0)).toBe(-50);
  });

  it("clamps to max scroll when content exceeds viewport", () => {
    // Content 1000px, viewport 400px at zoom 1 → maxScroll = 1000 - MIN_VISIBLE_PX
    expect(clampScroll(1000, 1000, 400, 1.0)).toBe(1000);
    expect(clampScroll(600, 1000, 400, 1.0)).toBe(600);
    expect(clampScroll(300, 1000, 400, 1.0)).toBe(300);
  });

  it("accounts for zoom when computing max scroll", () => {
    // Content 1000px, viewport 800px, zoom 2 → maxScroll = 980, 700 is within range
    expect(clampScroll(700, 1000, 800, 2.0)).toBe(700);
    // Content 1000px, viewport 800px, zoom 0.5 → scaledViewport=1600, minVisible=min(100,20)=20
    //   minScroll=-(1600-20)=-1580, scroll 100 is within range
    expect(clampScroll(100, 1000, 800, 0.5)).toBe(0);
  });

  it("handles edge case of exactly fitting content", () => {
    // Same overscroll rule applies even when scaledContent === viewport.
    expect(clampScroll(0, 800, 800, 1.0)).toBe(0);
    expect(clampScroll(50, 800, 800, 1.0)).toBe(0);
  });

  it("re-clamps correctly when viewport grows (simulating container resize)", () => {
    // Initially: content 1000px, viewport 400px → max scroll = 980, 500 is within range
    const scrollBefore = clampScroll(500, 1000, 400, 1.0);
    expect(scrollBefore).toBe(500);

    // Container grows to 800px → maxScroll = 980, 500 is still within range
    const scrollAfter = clampScroll(scrollBefore, 1000, 800, 1.0);
    expect(scrollAfter).toBe(500);
  });

  it("re-clamps correctly when viewport shrinks (simulating container resize)", () => {
    // Initially: content 1000px, viewport 800px → max scroll = 980, 200 within range
    const scrollBefore = clampScroll(200, 1000, 800, 1.0);
    expect(scrollBefore).toBe(200);

    // Container shrinks to 400px → max scroll = 980, scroll stays at 200
    const scrollAfter = clampScroll(scrollBefore, 1000, 400, 1.0);
    expect(scrollAfter).toBe(200);
  });

  it("preserves user scroll when viewport grows larger than content", () => {
    // Previously this snapped content back to centered; the snap is now
    // confined to restScroll() so user-driven scrolls survive resizes.
    const scrollBefore = clampScroll(100, 500, 400, 1.0);
    expect(scrollBefore).toBe(100);

    // Container grows to 600px → content fits, but scroll is preserved
    // (within overscroll bounds, which are large).
    const scrollAfter = clampScroll(scrollBefore, 500, 600, 1.0);
    expect(scrollAfter).toBe(0);
  });

  it("re-clamps correctly during resize with zoom applied", () => {
    // Content 1000px, viewport 600px, zoom 2 → max scroll = 980, 500 within range
    const scrollBefore = clampScroll(500, 1000, 600, 2.0);
    expect(scrollBefore).toBe(500);

    // Viewport grows to 1200px, zoom 2 → maxScroll = 980, 500 is still within range
    const scrollAfter = clampScroll(scrollBefore, 1000, 1200, 2.0);
    expect(scrollAfter).toBe(500);
  });
});

describe("restScroll", () => {
  it("centers content (PDF-viewer style) when content fits and anchor is 'center'", () => {
    // Content 500px, viewport 800px at zoom 1 → -(800-500)/(2*1) = -150
    expect(restScroll(500, 800, 1.0, "center")).toBe(-150);
  });

  it("flushes content to start edge with padding when anchor is 'start'", () => {
    expect(restScroll(500, 800, 1.0, "start", 24)).toBe(-24);
  });

  it("returns 0 (or -pad) when content overflows", () => {
    expect(restScroll(2000, 800, 1.0, "center")).toBe(0);
    expect(restScroll(2000, 800, 1.0, "start", 24)).toBe(-24);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the zoom point stationary when zooming in", () => {
    const v: ViewportState = { scrollX: 0, scrollY: 0, zoom: 1.0 };
    const result = zoomAtPoint(v, 200, 150, 2.0);

    expect(result.zoom).toBe(2.0);
    // At zoom 1: content(200, 150) maps to viewport(200, 150)
    // At zoom 2: content(200, 150) should still map to viewport(200, 150)
    // content = scrollX + viewportX / zoom
    // 200 = 0 + 200/1 → content point is (200, 150)
    // After zoom: 200 = newScrollX + 200/2 → newScrollX = 100
    expect(result.scrollX).toBeCloseTo(100);
    expect(result.scrollY).toBeCloseTo(75);
  });

  it("keeps the zoom point stationary when zooming out", () => {
    const v: ViewportState = { scrollX: 100, scrollY: 100, zoom: 2.0 };
    const result = zoomAtPoint(v, 300, 200, 1.0);

    expect(result.zoom).toBe(1.0);
    // Content point: 100 + 300/2 = 250, 100 + 200/2 = 200
    // After zoom: newScrollX = 250 - 300/1 = -50
    expect(result.scrollX).toBeCloseTo(-50);
    expect(result.scrollY).toBeCloseTo(0);
  });

  it("clamps zoom to boundaries", () => {
    const v: ViewportState = { scrollX: 0, scrollY: 0, zoom: 1.0 };
    const result = zoomAtPoint(v, 100, 100, 10.0);
    expect(result.zoom).toBe(MAX_ZOOM);
  });

  it("preserves position when zoom unchanged", () => {
    const v: ViewportState = { scrollX: 50, scrollY: 75, zoom: 1.5 };
    const result = zoomAtPoint(v, 200, 200, 1.5);
    expect(result.scrollX).toBeCloseTo(50);
    expect(result.scrollY).toBeCloseTo(75);
    expect(result.zoom).toBe(1.5);
  });

  it("zooms at origin correctly", () => {
    const v: ViewportState = { scrollX: 0, scrollY: 0, zoom: 1.0 };
    const result = zoomAtPoint(v, 0, 0, 2.0);
    // Content at (0,0) stays at viewport (0,0)
    expect(result.scrollX).toBeCloseTo(0);
    expect(result.scrollY).toBeCloseTo(0);
    expect(result.zoom).toBe(2.0);
  });
});

describe("drag/pan scroll computation", () => {
  // These tests verify the math used by the drag handler:
  // newScrollX = clampScroll(scrollX - dx / zoom, contentWidth, viewportWidth, zoom)

  it("pans right when dragging left (negative dx)", () => {
    // Drag left by 100px at zoom 1 → scroll increases by 100
    const scrollX = clampScroll(0 - -100 / 1.0, 2000, 800, 1.0);
    expect(scrollX).toBe(100);
  });

  it("pans down when dragging up (negative dy)", () => {
    const scrollY = clampScroll(0 - -50 / 1.0, 2000, 600, 1.0);
    expect(scrollY).toBe(50);
  });

  it("pans left when dragging right (positive dx)", () => {
    const scrollX = clampScroll(200 - 100 / 1.0, 2000, 800, 1.0);
    expect(scrollX).toBe(100);
  });

  it("scales drag distance by zoom factor", () => {
    // At zoom 2, dragging 100px should scroll 50 content units
    const scrollX = clampScroll(0 - -100 / 2.0, 2000, 800, 2.0);
    expect(scrollX).toBe(50);
  });

  it("clamps drag to not exceed content bounds", () => {
    // Content 1000px, viewport 800px at zoom 1 → maxScroll = 980, 600 is within range
    const scrollX = clampScroll(100 - -500 / 1.0, 1000, 800, 1.0);
    expect(scrollX).toBe(600);
  });

  it("allows negative scroll during drag within bounds", () => {
    // Dragging right from scrollX=50 by 200px → -150, minScroll=-780, within range
    const scrollX = clampScroll(50 - 200 / 1.0, 2000, 800, 1.0);
    expect(scrollX).toBe(-150);
  });

  it("preserves drag scroll when content fits in viewport (no snap-to-center)", () => {
    // Previously this snapped to centered: -(800-500)/2 = -150
    // Now overscroll is allowed when content fits, so drag scrolls survive.
    const scrollX = clampScroll(0 - -100 / 1.0, 500, 800, 1.0);
    expect(scrollX).toBe(0);
  });
});

describe("clampScroll boundaries vs UI chrome", () => {
  it("keeps a screen-pixel slice visible regardless of zoom", () => {
    // At a very low zoom the old content-unit cap left a hairline sliver.
    // A small screen-space edge remains visible at the trailing bound.
    const maxScroll = clampScroll(Number.POSITIVE_INFINITY, 40000, 800, 0.05);
    // Content right edge sits MIN_VISIBLE_PX inside the left viewport edge.
    expect((40000 - maxScroll) * 0.05).toBeCloseTo(0);

    const minScroll = clampScroll(Number.NEGATIVE_INFINITY, 40000, 800, 0.05);
    // Content left edge stops just before the right viewport edge.
    expect(-minScroll * 0.05).toBeCloseTo(776);
  });

  it("keeps content clear of leading chrome at the max bound", () => {
    // A 300px floating left panel: content may not be pushed behind it.
    const maxScroll = clampScroll(Number.POSITIVE_INFINITY, 2000, 800, 1.0, { leading: 300 });
    expect(2000 - maxScroll).toBeCloseTo(300);
  });

  it("keeps content clear of trailing chrome at the min bound", () => {
    // A 200px status/inspector strip on the trailing edge.
    const minScroll = clampScroll(Number.NEGATIVE_INFINITY, 2000, 800, 1.0, { trailing: 200 });
    expect(-minScroll).toBeCloseTo(576);
  });

  it("accounts for the leading blank turn space in horizontal spreads", () => {
    // spread-h puts the first painted page one page-width to the right of
    // the content origin. Keep that page's music visible when scrolling left.
    const pageWidth = 700;
    const spreadWidth = 2800;
    const minScroll = clampScroll(Number.NEGATIVE_INFINITY, spreadWidth, 800, 1, {
      contentStart: pageWidth,
      edgeVisibleRatio: 0.1,
    });
    expect(pageWidth - minScroll).toBeCloseTo(520);
  });

  it("keeps tiny content inside the safe region when chrome dominates", () => {
    // Safe span (800-350-350=100) barely larger than the 40px content.
    // The cap must not allow the content to sit under either panel.
    const scroll = clampScroll(9999, 40, 800, 1.0, { leading: 350, trailing: 350 });
    const contentLeft = -scroll;
    expect(contentLeft).toBeGreaterThanOrEqual(350);
    expect(contentLeft + 40).toBeLessThanOrEqual(450);
  });

  it("ignores degenerate insets wider than the container", () => {
    const scroll = clampScroll(0, 2000, 400, 1.0, { leading: 500, trailing: 500 });
    expect(scroll).toBe(0);
  });
});

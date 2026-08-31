import { describe, it, expect, vi, beforeEach } from "vitest";
import { GlyphAtlas, COMMON_GLYPHS } from "../glyphAtlas";

// Mock OffscreenCanvas for Node/Vitest environment
function createMockOffscreenCanvas(): OffscreenCanvas {
  const mockCtx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    measureText: vi.fn().mockReturnValue({
      width: 20,
      actualBoundingBoxLeft: 2,
      actualBoundingBoxRight: 18,
      actualBoundingBoxAscent: 30,
      actualBoundingBoxDescent: 5,
    }),
  };

  const mockCanvas = {
    width: 1024,
    height: 1024,
    getContext: vi.fn().mockReturnValue(mockCtx),
  };

  return mockCanvas as unknown as OffscreenCanvas;
}

// Stub global OffscreenCanvas
const origOffscreenCanvas = globalThis.OffscreenCanvas;
beforeEach(() => {
  globalThis.OffscreenCanvas = vi.fn().mockImplementation(function (w: number, h: number) {
    const c = createMockOffscreenCanvas();
    (c as { width: number }).width = w;
    (c as { height: number }).height = h;
    return c;
  }) as unknown as typeof OffscreenCanvas;
});

// Restore after all tests
import { afterAll } from "vitest";
afterAll(() => {
  globalThis.OffscreenCanvas = origOffscreenCanvas;
});

describe("GlyphAtlas", () => {
  it("should create an atlas with default config", () => {
    const atlas = new GlyphAtlas();
    expect(atlas.fontSize).toBe(40);
    expect(atlas.isBuilt).toBe(false);
  });

  it("should create an atlas with custom config", () => {
    const atlas = new GlyphAtlas({ fontSize: 24, atlasWidth: 512 });
    expect(atlas.fontSize).toBe(24);
  });

  it("should build atlas and populate entries", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();

    expect(atlas.isBuilt).toBe(true);
    const stats = atlas.getStats();
    expect(stats.entryCount).toBeGreaterThan(0);
    expect(stats.fontSize).toBe(40);
  });

  it("should report hasGlyph for common glyphs after build", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();

    // noteheadBlack should be in atlas
    expect(atlas.hasGlyph(0xe0a4, "#000000")).toBe(true);
    // gClef should be in atlas
    expect(atlas.hasGlyph(0xe050, "#000000")).toBe(true);
  });

  it("should not have glyphs before build", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    expect(atlas.hasGlyph(0xe0a4, "#000000")).toBe(false);
  });

  it("should not have non-atlas codepoints", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();
    // 0xFFFF is not a common glyph
    expect(atlas.hasGlyph(0xffff, "#000000")).toBe(false);
  });

  it("should rebuild atlas on zoom change", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();
    expect(atlas.fontSize).toBe(40);

    atlas.rebuild(24);
    expect(atlas.fontSize).toBe(24);
    expect(atlas.isBuilt).toBe(true);
    // Entries should be repopulated
    expect(atlas.getStats().entryCount).toBeGreaterThan(0);
  });

  it("should return false from drawGlyph when size doesn't match", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();

    const ctx = createMockCtx();
    // Atlas built for 40, requesting 24 → should return false
    const drawn = atlas.drawGlyph(ctx, 0xe0a4, 10, 20, 24, "#000000");
    expect(drawn).toBe(false);
  });

  it("should return true from drawGlyph when size matches and glyph exists", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();

    const ctx = createMockCtx();
    const drawn = atlas.drawGlyph(ctx, 0xe0a4, 10, 20, 40, "#000000");
    expect(drawn).toBe(true);
  });

  it("should return false from drawGlyph for unknown codepoint", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();

    const ctx = createMockCtx();
    const drawn = atlas.drawGlyph(ctx, 0xffff, 10, 20, 40, "#000000");
    expect(drawn).toBe(false);
  });

  it("should differentiate glyphs by color", () => {
    const atlas = new GlyphAtlas({ fontSize: 40 });
    atlas.build();

    // Default build only rasterizes #000000
    expect(atlas.hasGlyph(0xe0a4, "#000000")).toBe(true);
    expect(atlas.hasGlyph(0xe0a4, "#FF0000")).toBe(false);
  });

  it("should rebuild for a new device scale so blits stay 1:1", () => {
    const atlas = new GlyphAtlas({ fontSize: 40, deviceScale: 1 });
    atlas.build();

    atlas.ensureDeviceScale(0.315);
    expect(atlas.deviceScale).toBe(0.315);
    expect(atlas.isBuilt).toBe(true);
    expect(atlas.getStats().entryCount).toBeGreaterThan(0);
  });

  it("should ignore sub-epsilon device-scale changes", () => {
    const atlas = new GlyphAtlas({ fontSize: 40, deviceScale: 2 });
    atlas.build();

    atlas.ensureDeviceScale(2.001);
    expect(atlas.deviceScale).toBe(2);
  });

  it("should scale the drawGlyph destination by the baked device scale", () => {
    const atlas = new GlyphAtlas({ fontSize: 40, deviceScale: 2 });
    atlas.build();

    const ctx = createMockCtx();
    expect(atlas.drawGlyph(ctx, 0xe0a4, 10, 20, 40, "#000000")).toBe(true);
    // Mock metrics: width = 2 + 18 = 20, ascent = 30, left bearing = 2.
    // Destination is divided by deviceScale (2) so the context transform
    // (dpr × zoom) reproduces the baked pixels exactly.
    const args = (ctx.drawImage as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(args[5]).toBeCloseTo(10 - 2 / 2);
    expect(args[6]).toBeCloseTo(20 - 30 / 2);
    expect(args[7]).toBeCloseTo(20 / 2);
    expect(args[8]).toBeCloseTo(35 / 2);
  });
});

describe("COMMON_GLYPHS", () => {
  it("should contain approximately 80 glyphs", () => {
    expect(COMMON_GLYPHS.length).toBeGreaterThanOrEqual(55);
    expect(COMMON_GLYPHS.length).toBeLessThanOrEqual(95);
  });

  it("should include essential noteheads", () => {
    expect(COMMON_GLYPHS).toContain(0xe0a4); // noteheadBlack
    expect(COMMON_GLYPHS).toContain(0xe0a3); // noteheadHalf
    expect(COMMON_GLYPHS).toContain(0xe0a2); // noteheadWhole
  });

  it("should include clefs", () => {
    expect(COMMON_GLYPHS).toContain(0xe050); // gClef
    expect(COMMON_GLYPHS).toContain(0xe062); // fClef
    expect(COMMON_GLYPHS).toContain(0xe05c); // cClef
  });

  it("should include all values as valid SMuFL codepoints", () => {
    for (const cp of COMMON_GLYPHS) {
      // SMuFL codepoints are in the Private Use Area (U+E000–U+F8FF)
      expect(cp).toBeGreaterThanOrEqual(0xe000);
      expect(cp).toBeLessThanOrEqual(0xf8ff);
    }
  });
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

/**
 * GlyphAtlas — pre-rasterizes common SMuFL glyphs to an OffscreenCanvas atlas.
 *
 * Instead of calling fillText() for every glyph, we rasterize each unique
 * (codepoint, size, color) combination once and draw via drawImage().
 * The atlas is invalidated when zoom (size) changes.
 *
 * Ref: docs/spec/performance-architecture.md §3.3
 */

/** Unique key for a cached glyph entry. */
interface GlyphEntry {
  /** X position in the atlas canvas. */
  x: number;
  /** Y position in the atlas canvas. */
  y: number;
  /** Rendered width (px). */
  width: number;
  /** Rendered height (px). */
  height: number;
  /** Baseline offset from top of the glyph bounding box. */
  baselineOffset: number;
  /** Left bearing: distance from alignment point to left ink edge. */
  leftBearing: number;
}

/** Configuration for the glyph atlas. */
export interface GlyphAtlasConfig {
  /** Font name (default: "Bravura"). */
  font: string;
  /** Logical font size in px (matches cmd.size from layout engine). */
  fontSize: number;
  /**
   * Device pixels per logical px at which glyphs are baked, i.e. the painting
   * context's `dpr * zoom`. Blitting a bitmap baked at any other scale forces
   * canvas to resample it — a bilinear downscale drops source pixels and makes
   * noteheads and clefs visibly aliased. Keep this in lockstep with the paint
   * transform via {@link GlyphAtlas.ensureDeviceScale} so every blit is 1:1.
   */
  deviceScale: number;
  /** Upper bound for the atlas canvas width (default: 2048). */
  atlasWidth: number;
  /** Upper bound for the atlas canvas height (default: 2048). */
  atlasHeight: number;
}

const DEFAULT_CONFIG: GlyphAtlasConfig = {
  font: "Bravura",
  fontSize: 40,
  deviceScale: 1,
  atlasWidth: 2048,
  atlasHeight: 2048,
};

/** Smallest atlas canvas side (px) — below this, packing slack costs nothing. */
const MIN_ATLAS_SIDE = 512;

/** Area multiplier per glyph cell, covering tall glyphs and row-packing waste. */
const ATLAS_PACKING_SLACK = 2.5;

/**
 * Relative change in device scale below which a rebuild is skipped. Sub-percent
 * mismatches are invisible and would otherwise thrash the atlas during smooth
 * zoom gestures.
 */
const SCALE_REBUILD_EPSILON = 0.005;

/**
 * ~50 most common SMuFL codepoints used in music notation.
 * Ordered by usage frequency.
 */
export const COMMON_GLYPHS: readonly number[] = [
  // Noteheads
  0xe0a4, // noteheadBlack
  0xe0a3, // noteheadHalf
  0xe0a2, // noteheadWhole
  0xe0a0, // noteheadDoubleWhole
  // Augmentation dot
  0xe1e7, // augmentationDot
  // Flags
  0xe240, // flag8thUp
  0xe241, // flag8thDown
  0xe242, // flag16thUp
  0xe243, // flag16thDown
  0xe244, // flag32ndUp
  0xe245, // flag32ndDown
  0xe246, // flag64thUp
  0xe247, // flag64thDown
  // Rests
  0xe4e1, // restMaxima
  0xe4e2, // restLong
  0xe4e3, // restDoubleWhole
  0xe4e4, // restWhole
  0xe4e5, // restHalf
  0xe4e6, // restQuarter
  0xe4e7, // rest8th
  0xe4e8, // rest16th
  0xe4e9, // rest32nd
  0xe4ea, // rest64th
  0xe4eb, // rest128th
  0xe4ec, // rest256th
  // Clefs
  0xe050, // gClef
  0xe05c, // cClef
  0xe062, // fClef
  // Accidentals
  0xe260, // accidentalFlat
  0xe261, // accidentalNatural
  0xe262, // accidentalSharp
  0xe263, // accidentalDoubleSharp
  0xe264, // accidentalDoubleFlat
  // Time signature digits
  0xe080, // timeSig0
  0xe081, // timeSig1
  0xe082, // timeSig2
  0xe083, // timeSig3
  0xe084, // timeSig4
  0xe085, // timeSig5
  0xe086, // timeSig6
  0xe087, // timeSig7
  0xe088, // timeSig8
  0xe089, // timeSig9
  0xe08a, // timeSigCommon
  0xe08b, // timeSigCut
  // Articulations (above)
  0xe4a0, // articAccentAbove
  0xe4a2, // articStaccatoAbove
  0xe4a4, // articTenutoAbove
  0xe4ac, // articMarcatoAbove
  // Fermatas
  0xe4c0, // fermataAbove
  0xe4c1, // fermataBelow
  0xe4c4, // fermataShortAbove
  0xe4c5, // fermataShortBelow
  0xe4c6, // fermataLongAbove
  0xe4c7, // fermataLongBelow
  0xe4c8, // fermataVeryLongAbove
  0xe4c9, // fermataVeryLongBelow
  0xe4c2, // fermataVeryShortAbove
  0xe4c3, // fermataVeryShortBelow
  0xe4ca, // fermataLongHenzeAbove
  0xe4cb, // fermataLongHenzeBelow
  0xe4cc, // fermataShortHenzeAbove
  0xe4cd, // fermataShortHenzeBelow
  0xe4d6, // curlewSign (MNX `curlew` fermata symbol)
  // String techniques (bow direction)
  0xe610, // stringsDownBow (MNX bowDirection direction=down)
  0xe612, // stringsUpBow (MNX bowDirection direction=up)
  // Breath marks
  0xe4ce, // breathMarkComma
  0xe4cf, // breathMarkTick
  0xe4d0, // breathMarkUpbow
  0xe4d5, // breathMarkSalzedo
  // Dynamics
  0xe520, // dynamicPiano
  0xe522, // dynamicForte
  0xe52f, // dynamicMF
  0xe52d, // dynamicMP
  // Ornaments
  0xe566, // ornamentTrill
  // Metronome note glyphs (tempo markings)
  0xeca0, // metNoteDoubleWhole
  0xeca2, // metNoteWhole
  0xeca3, // metNoteHalfUp
  0xeca5, // metNoteQuarterUp
  0xeca7, // metNote8thUp
  0xeca9, // metNote16thUp
  0xecab, // metNote32ndUp
  0xecad, // metNote64thUp
  0xecb7, // metAugmentationDot
];

function makeKey(codepoint: number, color: string): string {
  return `${codepoint}:${color}`;
}

export class GlyphAtlas {
  private atlas: OffscreenCanvas;
  private atlasCtx: OffscreenCanvasRenderingContext2D;
  private entries: Map<string, GlyphEntry> = new Map();
  private config: GlyphAtlasConfig;
  /** Actual atlas canvas dimensions (derived from the baked raster size). */
  private atlasW: number;
  private atlasH: number;
  /** Current packing cursor position. */
  private cursorX = 0;
  private cursorY = 0;
  private rowHeight = 0;
  private built = false;

  constructor(config?: Partial<GlyphAtlasConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.atlasW = this.config.atlasWidth;
    this.atlasH = this.config.atlasHeight;
    this.atlas = new OffscreenCanvas(this.atlasW, this.atlasH);
    const ctx = this.atlas.getContext("2d");
    if (!ctx) throw new Error("Failed to get OffscreenCanvas 2D context");
    this.atlasCtx = ctx;
  }

  /** Current font size this atlas was built for. */
  get fontSize(): number {
    return this.config.fontSize;
  }

  /** Device scale (`dpr * zoom`) the current bitmaps were baked at. */
  get deviceScale(): number {
    return this.config.deviceScale;
  }

  /**
   * Rebuild the atlas if the painting context's device scale (`dpr * zoom`)
   * has moved away from the baked scale. Call this once per frame before
   * painting so glyph blits stay 1:1 with device pixels.
   */
  ensureDeviceScale(deviceScale: number, fontSize?: number): void {
    if (!(deviceScale > 0)) return;
    const sizeChanged = fontSize !== undefined && fontSize !== this.config.fontSize;
    const scaleChanged = Math.abs(deviceScale / this.config.deviceScale - 1) > SCALE_REBUILD_EPSILON;
    if (this.built && !sizeChanged && !scaleChanged) return;
    this.config.deviceScale = deviceScale;
    this.build(fontSize);
  }

  /** Whether the atlas has been built. */
  get isBuilt(): boolean {
    return this.built;
  }

  /**
   * Build (or rebuild) the atlas for the given font size.
   * Call this on startup and whenever zoom changes.
   */
  build(fontSize?: number): void {
    if (fontSize !== undefined) {
      this.config.fontSize = fontSize;
    }

    // Reset packing state
    this.entries.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.rowHeight = 0;

    // Size the canvas to the baked glyph size. At life-size zoom the raster is
    // ~15px, so a small canvas holds every glyph and rebuilding on zoom change
    // costs far less than the tile re-render that accompanies it.
    this.resizeAtlasFor(this.config.fontSize * this.config.deviceScale);
    this.atlasCtx.clearRect(0, 0, this.atlasW, this.atlasH);

    // Pre-rasterize the default color (#000000) for all common glyphs
    this.rasterizeGlyphs(COMMON_GLYPHS, "#000000");
    this.built = true;
  }

  /**
   * Grow/shrink the atlas canvas to fit `COMMON_GLYPHS` at the given raster
   * size. Glyph cells average roughly one raster square each (taller glyphs
   * like clefs offset narrower ones); the packing slack factor keeps row-based
   * packing from overflowing. Setting width/height also clears the canvas.
   */
  private resizeAtlasFor(rasterSize: number): void {
    const side = Math.ceil(Math.sqrt(ATLAS_PACKING_SLACK * COMMON_GLYPHS.length) * rasterSize);
    const w = Math.min(this.config.atlasWidth, Math.max(MIN_ATLAS_SIDE, side));
    const h = Math.min(this.config.atlasHeight, Math.max(MIN_ATLAS_SIDE, side));
    this.atlasW = w;
    this.atlasH = h;
    this.atlas.width = w;
    this.atlas.height = h;
  }

  /**
   * Rasterize a set of glyphs with a given color into the atlas.
   */
  private rasterizeGlyphs(codepoints: readonly number[], color: string): void {
    const ctx = this.atlasCtx;
    const { font, fontSize, deviceScale } = this.config;
    const atlasWidth = this.atlasW;
    const atlasHeight = this.atlasH;
    const rasterSize = fontSize * deviceScale;

    ctx.font = `${rasterSize}px ${font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Padding around each glyph
    const pad = 2;

    for (const cp of codepoints) {
      const text = String.fromCodePoint(cp);
      const metrics = ctx.measureText(text);

      // Compute bounding box from TextMetrics
      const width = Math.ceil((metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? metrics.width));
      const ascent = Math.ceil(metrics.actualBoundingBoxAscent ?? fontSize);
      const descent = Math.ceil(metrics.actualBoundingBoxDescent ?? fontSize * 0.3);
      const height = ascent + descent;

      // Skip degenerate glyphs
      if (width <= 0 || height <= 0) continue;

      const cellW = width + pad * 2;
      const cellH = height + pad * 2;

      // Advance to next row if needed
      if (this.cursorX + cellW > atlasWidth) {
        this.cursorX = 0;
        this.cursorY += this.rowHeight;
        this.rowHeight = 0;
      }

      // Check if we've run out of space
      if (this.cursorY + cellH > atlasHeight) {
        break;
      }

      // Draw the glyph
      ctx.fillStyle = color;
      ctx.fillText(text, this.cursorX + pad + (metrics.actualBoundingBoxLeft ?? 0), this.cursorY + pad + ascent);

      // Store entry
      const key = makeKey(cp, color);
      this.entries.set(key, {
        x: this.cursorX + pad,
        y: this.cursorY + pad,
        width,
        height,
        baselineOffset: ascent,
        leftBearing: metrics.actualBoundingBoxLeft ?? 0,
      });

      this.cursorX += cellW;
      this.rowHeight = Math.max(this.rowHeight, cellH);
    }
  }

  /**
   * Check if a glyph is in the atlas.
   */
  hasGlyph(codepoint: number, color: string = "#000000"): boolean {
    return this.entries.has(makeKey(codepoint, color));
  }

  /**
   * Draw a glyph from the atlas onto a target context.
   * Returns true if the glyph was drawn from atlas, false if it needs fallback.
   */
  drawGlyph(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    codepoint: number,
    x: number,
    y: number,
    size: number,
    color: string,
  ): boolean {
    // Only use atlas if logical size matches
    if (size !== this.config.fontSize) return false;

    const entry = this.entries.get(makeKey(codepoint, color));
    if (!entry) return false;

    // Atlas pixels are baked at `deviceScale`; dividing the destination by the
    // same factor recovers logical px. The context transform then re-applies
    // `dpr * zoom`, so as long as the atlas was built for the current device
    // scale (see ensureDeviceScale) the blit is 1:1 — no resampling, no
    // aliasing.
    const scale = this.config.deviceScale;
    ctx.drawImage(
      this.atlas,
      entry.x,
      entry.y,
      entry.width,
      entry.height,
      x - entry.leftBearing / scale,
      y - entry.baselineOffset / scale,
      entry.width / scale,
      entry.height / scale,
    );
    return true;
  }

  /**
   * Invalidate and rebuild for a new font size (zoom change).
   */
  rebuild(fontSize: number): void {
    this.build(fontSize);
  }

  /**
   * Get atlas stats for debugging/benchmarking.
   */
  getStats(): { entryCount: number; fontSize: number; built: boolean } {
    return {
      entryCount: this.entries.size,
      fontSize: this.config.fontSize,
      built: this.built,
    };
  }
}

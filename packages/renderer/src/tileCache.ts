/**
 * Tile-based rendering cache for score canvases.
 *
 * Pre-renders the display list into fixed-size tiles at the current zoom level.
 * On scroll, blits cached tiles instead of repainting all render commands.
 * Tiles are invalidated when zoom or content changes.
 *
 * Supports dirty tile invalidation: when content changes, only tiles overlapping
 * modified measures are invalidated (via invalidateMeasures), not the entire cache.
 *
 * Performance: reduces per-frame paint from O(commands) to O(visible tiles).
 * For a 32-bar orchestral score, that's ~1500 draw calls → ~6 drawImage blits.
 */

import { paintCommand } from "./displayListPainter";
import { computeHorizonPaperGeometry, paintPaperPage, PAPER_SHADOW_MARGIN } from "./paperPagePainter";
import { splitCommandsByPage } from "./pageCache";
import type { DisplayList, RenderCommand, MeasureBounds } from "./wasm";
import type { GlyphAtlas } from "./glyphAtlas";
import { renderCommandBounds } from "./renderCommandBounds";

/** Default tile size in CSS pixels. Larger = fewer tiles but more memory per tile. */
export const DEFAULT_TILE_SIZE = 512;

/**
 * Width (in content px) of one horizontal command bucket for horizon view.
 * Horizon emits a single unbroken system that can be ~190k px wide; without a
 * spatial split every tile would re-scan the entire command list (O(tiles ×
 * commands)). Bucketing along X lets each tile iterate only the commands whose
 * X-extent overlaps the visible band, mirroring how page view splits commands
 * by page along Y. Chosen so a tile spans only a handful of buckets across the
 * usual zoom range (a 512px tile is ~1.7k content px at the default 0.3 zoom).
 */
const HORIZON_BUCKET_WIDTH = 2048;

/** Max cached tiles before distant ones are evicted (bounds memory for very wide horizon scores). */
const MAX_CACHED_TILES = 512;

/** Column buffer kept around the visible range when evicting distant tiles. */
const TILE_EVICT_BUFFER = 8;

/**
 * Horizontal spatial index over a display list's commands for horizon view.
 * `buckets[b]` holds the ascending global indices of commands whose X-extent
 * overlaps band `[minX + b*bucketWidth, minX + (b+1)*bucketWidth)`. Commands
 * spanning multiple bands appear in each overlapping bucket. Position-less
 * commands (SetOpacity — order-dependent global state) are collected separately
 * in `opacityIndices` and merged into every tile so alpha state stays correct.
 */
interface HorizonIndex {
  bucketWidth: number;
  minX: number;
  buckets: number[][];
  opacityIndices: number[];
}

/**
 * K-way merge of the sorted index arrays for buckets `b1..b2` plus `extra`
 * (opacity indices), producing a single ascending, de-duplicated index list so
 * commands paint in their original global order with no double-draw.
 */
function mergeSortedUnique(buckets: number[][], b1: number, b2: number, extra: number[]): number[] {
  const lists: number[][] = [];
  for (let b = b1; b <= b2; b++) {
    const l = buckets[b];
    if (l && l.length > 0) lists.push(l);
  }
  if (extra.length > 0) lists.push(extra);
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0]!;

  const pointers = new Array<number>(lists.length).fill(0);
  const out: number[] = [];
  let last = -1;
  for (;;) {
    let minVal = Infinity;
    let minList = -1;
    for (let k = 0; k < lists.length; k++) {
      const list = lists[k]!;
      const p = pointers[k]!;
      if (p < list.length && list[p]! < minVal) {
        minVal = list[p]!;
        minList = k;
      }
    }
    if (minList === -1) break;
    pointers[minList]!++;
    if (minVal !== last) {
      out.push(minVal);
      last = minVal;
    }
  }
  return out;
}

/**
 * Compute the actual bounding box of all render commands, extended past the
 * nominal `displayList.width`/`height` and padded so edge text and the paper
 * shadow halo aren't clipped.
 *
 * This is the single source of truth for "how far does painted content
 * actually reach". The tile renderer uses it to decide which tiles exist, and
 * the editor's scroll clamp uses it (via `contentSizeForMode`) so the viewport
 * can scroll to every painted pixel. Keeping both on the same function avoids
 * the bug where the scroll clamp stopped short of content that overhangs the
 * nominal dimensions (most visible at high zoom on wide horizon scores).
 */
export function computeDisplayListContentBounds(displayList: DisplayList): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = 0;
  let minY = 0;
  let maxX = displayList.width;
  let maxY = displayList.height;

  for (const cmd of displayList.commands) {
    const b = renderCommandBounds(cmd);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x2 > maxX) maxX = b.x2;
    if (b.y2 > maxY) maxY = b.y2;
  }

  // Generous padding so text at edges isn't clipped AND the paper shadow
  // halo gets rendered into tiles outside the page bounds. Without this,
  // the shadow falls into unallocated tiles and is invisible in
  // tile-cached mode.
  const pad = PAPER_SHADOW_MARGIN + 8;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Key for a tile at (col, row). */
function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

interface TileRenderOpts {
  displayList: DisplayList;
  zoom: number;
  dpr: number;
  glyphAtlas: GlyphAtlas | null;
  viewMode: "page" | "spread" | "spread-h" | "horizon";
  canvasBg: string;
  paperFill: string | CanvasPattern;
  pageStackGap: number;
  printableInsets: PageInsets;
}

interface PageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PaintFrameOpts {
  canvas: HTMLCanvasElement;
  displayList: DisplayList;
  scrollX: number;
  scrollY: number;
  zoom: number;
  version: number;
  glyphAtlas: GlyphAtlas | null;
  viewMode?: "page" | "spread" | "spread-h" | "horizon";
  canvasBg?: string;
  paperFill?: string | CanvasPattern;
  pageStackGap?: number;
  printableInsets?: PageInsets;
}

function paintHorizonPaper(
  ctx: CanvasRenderingContext2D,
  displayList: DisplayList,
  viewMode: TileRenderOpts["viewMode"],
  paperFill: string | CanvasPattern,
): void {
  if (viewMode !== "horizon") return;
  const paper = computeHorizonPaperGeometry(displayList);
  paintPaperPage(ctx, paper.x, paper.y, paper.width, paper.height, paperFill);
}

function paintPageBackgrounds(
  ctx: CanvasRenderingContext2D,
  displayList: DisplayList,
  viewMode: TileRenderOpts["viewMode"],
  pageStackGap: number,
  paperFill: string | CanvasPattern,
  contentY: number,
  contentH: number,
): void {
  if (viewMode !== "page" || !displayList.pages || displayList.pages.length === 0) return;
  const pageW = displayList.width;
  for (let pi = 0; pi < displayList.pages.length; pi++) {
    const page = displayList.pages[pi];
    if (!page) continue;
    const visualY = page.yOffset + pi * pageStackGap;
    const pageBottom = visualY + page.height;
    if (pageBottom + PAPER_SHADOW_MARGIN < contentY || visualY - PAPER_SHADOW_MARGIN > contentY + contentH) continue;
    paintPaperPage(ctx, 0, visualY, pageW, page.height, paperFill);
  }
}

/**
 * Paint render commands, skipping those whose bounding box lies fully outside
 * the cull rectangle. Commands without a bounding box (e.g. `SetOpacity`) carry
 * order-dependent global state and are always painted so opacity stays correct
 * regardless of which commands get culled. Exported for direct-paint callers
 * (spread view, zoom/import frames) that bypass the tile cache.
 */
export function paintCommandsCulled(
  ctx: CanvasRenderingContext2D,
  commands: readonly RenderCommand[],
  glyphAtlas: GlyphAtlas | null,
  cullX1: number,
  cullX2: number,
  cullY1: number,
  cullY2: number,
): void {
  for (const cmd of commands) {
    const b = renderCommandBounds(cmd);
    if (b && (b.x2 < cullX1 || b.x > cullX2 || b.y2 < cullY1 || b.y > cullY2)) continue;
    if (cmd.type === "DrawGlyph" && glyphAtlas?.isBuilt) {
      const drawn = glyphAtlas.drawGlyph(ctx, cmd.codepoint, cmd.x, cmd.y, cmd.size, cmd.color);
      if (drawn) continue;
    }
    paintCommand(ctx, cmd);
  }
}

export class TileCache {
  private tiles = new Map<string, HTMLCanvasElement>();
  private tileSize: number;
  private cachedVersion = -1;
  private cachedZoom = -1;
  private cachedDpr = -1;
  private cachedViewMode: "page" | "spread" | "spread-h" | "horizon" = "page";
  private cachedCanvasBg = "";
  /** Last paper fill (cream string or CanvasPattern) used to render tiles.
   *  Identity comparison — a CanvasPattern object stays stable per theme,
   *  and a transition from cream-string to pattern triggers re-render. */
  private cachedPaperFill: string | CanvasPattern = "";
  /** Last page-stack gap (px) used. Invalidates tiles on change. */
  private cachedPageStackGap = 0;
  private cachedPrintableInsets = "";

  /** Per-page command split for page view (rebuilt when version changes). */
  private pageCommands: RenderCommand[][] | null = null;

  /** Horizontal command index for horizon view (rebuilt when version changes). */
  private horizonBuckets: HorizonIndex | null = null;

  /** Previous measure bounds for dirty tile detection. */
  private prevMeasureBounds: readonly MeasureBounds[] = [];

  /** Cached actual content bounds (min/max across all commands). */
  private contentBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  /** Max new tiles to render per frame. Remaining tiles render in subsequent frames. */
  private maxNewTilesPerFrame = 24;

  /** Number of tiles rendered in the last paintFrame call. */
  tilesRendered = 0;
  /** Number of tiles blitted from cache in the last paintFrame call. */
  tilesCached = 0;
  /** True if there are uncached visible tiles that weren't rendered this frame. */
  hasPendingTiles = false;

  constructor(tileSize = DEFAULT_TILE_SIZE) {
    this.tileSize = tileSize;
  }

  /** Invalidate all cached tiles (e.g. on zoom change). */
  invalidate(): void {
    this.tiles.clear();
  }

  /** Compute the actual bounding box of all render commands, with padding. */
  private computeContentBounds(displayList: DisplayList): { minX: number; minY: number; maxX: number; maxY: number } {
    return computeDisplayListContentBounds(displayList);
  }

  /**
   * Invalidate only tiles overlapping changed measures.
   * Compares old and new MeasureBounds by measure_id to find dirty regions,
   * then deletes only those tiles that overlap the changed rectangles.
   */
  invalidateMeasures(oldBounds: readonly MeasureBounds[], newBounds: readonly MeasureBounds[], zoom: number): void {
    // Build map of old bounds by measure_id+partIndex for comparison
    const oldMap = new Map<string, MeasureBounds>();
    for (const mb of oldBounds) {
      const key = `${mb.measureId ?? mb.index}:${mb.partIndex}`;
      oldMap.set(key, mb);
    }

    // Find dirty rectangles: measures that changed position, size, or are new/removed
    const dirtyRects: Array<{ x: number; y: number; x2: number; y2: number }> = [];

    for (const mb of newBounds) {
      const key = `${mb.measureId ?? mb.index}:${mb.partIndex}`;
      const old = oldMap.get(key);
      if (!old || old.x !== mb.x || old.y !== mb.y || old.width !== mb.width || old.height !== mb.height) {
        // This measure changed — mark both old and new rectangles as dirty
        dirtyRects.push({ x: mb.x, y: mb.y, x2: mb.x + mb.width, y2: mb.y + mb.height });
        if (old) {
          dirtyRects.push({ x: old.x, y: old.y, x2: old.x + old.width, y2: old.y + old.height });
        }
      }
      oldMap.delete(key);
    }

    // Any remaining old entries were deleted measures
    for (const old of oldMap.values()) {
      dirtyRects.push({ x: old.x, y: old.y, x2: old.x + old.width, y2: old.y + old.height });
    }

    if (dirtyRects.length === 0) return;

    // Delete tiles overlapping any dirty rectangle
    const ts = this.tileSize;
    const keysToDelete: string[] = [];
    for (const [key, _tile] of this.tiles) {
      const [colStr, rowStr] = key.split(",");
      const col = parseInt(colStr!, 10);
      const row = parseInt(rowStr!, 10);
      // Tile covers content rect
      const tileX1 = (col * ts) / zoom;
      const tileY1 = (row * ts) / zoom;
      const tileX2 = ((col + 1) * ts) / zoom;
      const tileY2 = ((row + 1) * ts) / zoom;

      for (const r of dirtyRects) {
        if (tileX2 > r.x && tileX1 < r.x2 && tileY2 > r.y && tileY1 < r.y2) {
          keysToDelete.push(key);
          break;
        }
      }
    }

    for (const key of keysToDelete) {
      this.tiles.delete(key);
    }
  }

  /**
   * Render a single tile at (col, row) in tile-grid coordinates.
   */
  private renderTile(col: number, row: number, opts: TileRenderOpts): HTMLCanvasElement {
    const { displayList, zoom, dpr, glyphAtlas, viewMode, canvasBg, paperFill, pageStackGap, printableInsets } = opts;
    const ts = this.tileSize;
    const deviceTs = Math.round(ts * dpr);
    const canvas = document.createElement("canvas");
    canvas.width = deviceTs;
    canvas.height = deviceTs;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const contentX = (col * ts) / zoom;
    const contentY = (row * ts) / zoom;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -contentX * dpr * zoom, -contentY * dpr * zoom);

    const contentW = ts / zoom;
    const contentH = ts / zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(contentX, contentY, contentW, contentH);
    ctx.clip();

    paintHorizonPaper(ctx, displayList, viewMode, paperFill);
    paintPageBackgrounds(ctx, displayList, viewMode, pageStackGap, paperFill, contentY, contentH);

    const margin = 20 / zoom;
    const usePagePaint = viewMode === "page" && (displayList.pages?.length ?? 0) > 0;
    if (usePagePaint && this.pageCommands) {
      this.paintStackedPageCommands(
        ctx,
        displayList,
        glyphAtlas,
        contentX,
        contentY,
        contentW,
        contentH,
        margin,
        pageStackGap,
        printableInsets,
      );
    } else if (viewMode === "horizon" && this.horizonBuckets) {
      this.paintHorizonBucketed(ctx, displayList, glyphAtlas, contentX, contentY, contentW, contentH, margin);
    } else {
      this.paintFlatCommands(ctx, displayList, glyphAtlas, contentX, contentY, contentW, contentH, margin);
    }

    ctx.restore();
    return canvas;
  }

  /**
   * Build the horizontal command index for horizon view. Must be called after
   * {@link computeContentBounds} has populated {@link contentBounds}.
   */
  private buildHorizonBuckets(displayList: DisplayList): HorizonIndex {
    const { minX, maxX } = this.contentBounds;
    const bucketWidth = HORIZON_BUCKET_WIDTH;
    const span = Math.max(1, maxX - minX);
    const bucketCount = Math.max(1, Math.ceil(span / bucketWidth));
    const buckets: number[][] = Array.from({ length: bucketCount }, () => []);
    const opacityIndices: number[] = [];
    const commands = displayList.commands;
    for (let i = 0; i < commands.length; i++) {
      const b = renderCommandBounds(commands[i]!);
      if (!b) {
        // Position-less (SetOpacity): order-dependent global state, kept apart
        // and merged into every tile so alpha is correct regardless of band.
        opacityIndices.push(i);
        continue;
      }
      let b1 = Math.floor((b.x - minX) / bucketWidth);
      let b2 = Math.floor((b.x2 - minX) / bucketWidth);
      if (b1 < 0) b1 = 0;
      if (b1 > bucketCount - 1) b1 = bucketCount - 1;
      if (b2 < 0) b2 = 0;
      if (b2 > bucketCount - 1) b2 = bucketCount - 1;
      for (let k = b1; k <= b2; k++) buckets[k]!.push(i);
    }
    return { bucketWidth, minX, buckets, opacityIndices };
  }

  /**
   * Paint one horizon tile using only the commands whose horizontal band
   * overlaps the tile, instead of scanning the entire command list.
   */
  private paintHorizonBucketed(
    ctx: CanvasRenderingContext2D,
    displayList: DisplayList,
    glyphAtlas: GlyphAtlas | null,
    contentX: number,
    contentY: number,
    contentW: number,
    contentH: number,
    margin: number,
  ): void {
    const cullX1 = contentX - margin;
    const cullX2 = contentX + contentW + margin;
    const cullY1 = contentY - margin;
    const cullY2 = contentY + contentH + margin;
    const { bucketWidth, minX, buckets, opacityIndices } = this.horizonBuckets!;
    const lastBucket = buckets.length - 1;
    let b1 = Math.floor((cullX1 - minX) / bucketWidth);
    let b2 = Math.floor((cullX2 - minX) / bucketWidth);
    if (b1 < 0) b1 = 0;
    if (b2 > lastBucket) b2 = lastBucket;
    if (b2 < 0 || b1 > lastBucket) return;

    const indices = mergeSortedUnique(buckets, b1, b2, opacityIndices);
    if (indices.length === 0) return;
    const commands = displayList.commands;
    const tileCmds = new Array<RenderCommand>(indices.length);
    for (let j = 0; j < indices.length; j++) tileCmds[j] = commands[indices[j]!]!;
    paintCommandsCulled(ctx, tileCmds, glyphAtlas, cullX1, cullX2, cullY1, cullY2);
  }

  private paintStackedPageCommands(
    ctx: CanvasRenderingContext2D,
    displayList: DisplayList,
    glyphAtlas: GlyphAtlas | null,
    contentX: number,
    contentY: number,
    contentW: number,
    contentH: number,
    margin: number,
    pageStackGap: number,
    printableInsets: PageInsets,
  ): void {
    const cullX1 = contentX - margin;
    const cullX2 = contentX + contentW + margin;
    for (let pi = 0; pi < this.pageCommands!.length; pi++) {
      const cmds = this.pageCommands![pi];
      if (!cmds || cmds.length === 0) continue;
      const dy = pi * pageStackGap;
      const page = displayList.pages?.[pi];
      if (!page) continue;
      const pageCullY1 = contentY - margin - dy;
      const pageCullY2 = contentY + contentH + margin - dy;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, page.yOffset + dy, displayList.width, Math.max(0, page.height - printableInsets.bottom));
      ctx.clip();
      ctx.translate(0, dy);
      paintCommandsCulled(ctx, cmds, glyphAtlas, cullX1, cullX2, pageCullY1, pageCullY2);
      ctx.restore();
    }
  }

  private paintFlatCommands(
    ctx: CanvasRenderingContext2D,
    displayList: DisplayList,
    glyphAtlas: GlyphAtlas | null,
    contentX: number,
    contentY: number,
    contentW: number,
    contentH: number,
    margin: number,
  ): void {
    const cullX1 = contentX - margin;
    const cullX2 = contentX + contentW + margin;
    const cullY1 = contentY - margin;
    const cullY2 = contentY + contentH + margin;
    paintCommandsCulled(ctx, displayList.commands, glyphAtlas, cullX1, cullX2, cullY1, cullY2);
  }

  /**
   * Paint the visible portion of the score onto the main canvas using cached tiles.
   * Call this instead of repaintCanvas for tile-cached rendering.
   *
   * @param opts.canvasBg - Canvas background color (read from CSS variable by caller)
   * @param opts.paperFill - Page fill (cream solid or CanvasPattern). A change in
   *   identity invalidates the cache so tiles get re-rendered with the new
   *   paper texture when it finishes loading.
   */
  paintFrame(opts: PaintFrameOpts): void {
    const {
      canvas,
      displayList,
      scrollX,
      scrollY,
      zoom,
      version,
      glyphAtlas,
      viewMode = "page",
      canvasBg = "#e0e2ea",
      paperFill = "#FFFFFF",
      pageStackGap = 0,
      printableInsets = { top: 0, right: 0, bottom: 0, left: 0 },
    } = opts;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    // Tiles rasterize at `dpr * zoom`; bake the atlas at the same scale so
    // glyph blits are 1:1 with device pixels instead of resampled (aliased).
    glyphAtlas?.ensureDeviceScale(dpr * zoom);

    this.maybeInvalidateForViewChange(zoom, viewMode, dpr, canvasBg, paperFill, pageStackGap, printableInsets);
    this.maybeInvalidateForVersionChange(version, displayList, viewMode);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const range = this.computeVisibleTileRange(canvas, scrollX, scrollY, zoom, dpr, displayList, pageStackGap);
    this.blitVisibleTiles(
      ctx,
      range,
      {
        displayList,
        zoom,
        dpr,
        glyphAtlas,
        viewMode,
        canvasBg,
        paperFill,
        pageStackGap,
        printableInsets,
      },
      scrollX,
      scrollY,
    );
  }

  private maybeInvalidateForViewChange(
    zoom: number,
    viewMode: TileRenderOpts["viewMode"],
    dpr: number,
    canvasBg: string,
    paperFill: string | CanvasPattern,
    pageStackGap: number,
    printableInsets: PageInsets,
  ): void {
    const printableInsetsKey = `${printableInsets.top},${printableInsets.right},${printableInsets.bottom},${printableInsets.left}`;
    if (
      zoom !== this.cachedZoom ||
      viewMode !== this.cachedViewMode ||
      dpr !== this.cachedDpr ||
      canvasBg !== this.cachedCanvasBg ||
      paperFill !== this.cachedPaperFill ||
      pageStackGap !== this.cachedPageStackGap ||
      printableInsetsKey !== this.cachedPrintableInsets
    ) {
      this.invalidate();
      this.cachedZoom = zoom;
      this.cachedViewMode = viewMode;
      this.cachedDpr = dpr;
      this.cachedCanvasBg = canvasBg;
      this.cachedPaperFill = paperFill;
      this.cachedPageStackGap = pageStackGap;
      this.cachedPrintableInsets = printableInsetsKey;
    }
  }

  private maybeInvalidateForVersionChange(
    version: number,
    displayList: DisplayList,
    viewMode: TileRenderOpts["viewMode"],
  ): void {
    if (version !== this.cachedVersion) {
      this.invalidate();
      this.prevMeasureBounds = displayList.measureBounds ?? [];
      this.cachedVersion = version;
      this.contentBounds = this.computeContentBounds(displayList);
      this.pageCommands = viewMode === "page" ? splitCommandsByPage(displayList).map((p) => p.commands) : null;
      this.horizonBuckets = viewMode === "horizon" ? this.buildHorizonBuckets(displayList) : null;
    } else {
      if (viewMode === "page" && !this.pageCommands) {
        this.pageCommands = splitCommandsByPage(displayList).map((p) => p.commands);
      }
      if (viewMode === "horizon" && !this.horizonBuckets) {
        this.horizonBuckets = this.buildHorizonBuckets(displayList);
      }
    }
  }

  private computeVisibleTileRange(
    canvas: HTMLCanvasElement,
    scrollX: number,
    scrollY: number,
    zoom: number,
    dpr: number,
    displayList: DisplayList,
    pageStackGap: number,
  ): {
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
    startCol: number;
    endCol: number;
    startRow: number;
    endRow: number;
  } {
    const ts = this.tileSize;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;
    const startCol = Math.floor((scrollX * zoom) / ts);
    const startRow = Math.floor((scrollY * zoom) / ts);
    const endCol = Math.ceil(((scrollX + viewW / zoom) * zoom) / ts);
    const endRow = Math.ceil(((scrollY + viewH / zoom) * zoom) / ts);
    const stackExtra = pageStackGap > 0 && displayList.pages ? (displayList.pages.length - 1) * pageStackGap : 0;
    const { minX, minY, maxX, maxY } = this.contentBounds;
    const minCol = Math.floor((minX * zoom) / ts);
    const minRow = Math.floor((minY * zoom) / ts);
    const maxCol = Math.ceil((maxX * zoom) / ts);
    const maxRow = Math.ceil(((maxY + stackExtra) * zoom) / ts);
    return { minCol, maxCol, minRow, maxRow, startCol, endCol, startRow, endRow };
  }

  private blitVisibleTiles(
    ctx: CanvasRenderingContext2D,
    range: ReturnType<TileCache["computeVisibleTileRange"]>,
    tileOpts: TileRenderOpts,
    scrollX: number,
    scrollY: number,
  ): void {
    const ts = this.tileSize;
    const { zoom, dpr } = tileOpts;
    this.tilesRendered = 0;
    this.tilesCached = 0;
    this.hasPendingTiles = false;

    for (let row = Math.max(range.minRow, range.startRow); row <= Math.min(range.maxRow, range.endRow); row++) {
      for (let col = Math.max(range.minCol, range.startCol); col <= Math.min(range.maxCol, range.endCol); col++) {
        const key = tileKey(col, row);
        let tile = this.tiles.get(key);
        if (!tile) {
          if (this.tilesRendered >= this.maxNewTilesPerFrame) {
            this.hasPendingTiles = true;
            continue;
          }
          tile = this.renderTile(col, row, tileOpts);
          this.tiles.set(key, tile);
          this.tilesRendered++;
        } else {
          this.tilesCached++;
        }
        const destX = Math.round(col * ts * dpr - scrollX * zoom * dpr);
        const destY = Math.round(row * ts * dpr - scrollY * zoom * dpr);
        ctx.drawImage(tile, destX, destY);
      }
    }

    this.evictDistantTiles(range);
  }

  /**
   * Bound memory for very wide scores (horizon can be ~190k px) by dropping
   * cached tiles whose column is far outside the visible range. Evicted tiles
   * simply re-render when scrolled back into view.
   */
  private evictDistantTiles(range: ReturnType<TileCache["computeVisibleTileRange"]>): void {
    if (this.tiles.size <= MAX_CACHED_TILES) return;
    const keepMin = range.startCol - TILE_EVICT_BUFFER;
    const keepMax = range.endCol + TILE_EVICT_BUFFER;
    for (const key of this.tiles.keys()) {
      const comma = key.indexOf(",");
      const col = parseInt(key.slice(0, comma), 10);
      if (col < keepMin || col > keepMax) this.tiles.delete(key);
    }
  }
}

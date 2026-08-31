/**
 * PageCache — OffscreenCanvas page cache with 5-page sliding window.
 *
 * Each page is rendered once to its own OffscreenCanvas. The visible canvas
 * composites cached pages via drawImage() for 60fps scrolling.
 *
 * Ref: docs/spec/performance-architecture.md §3.1
 */

import type { DisplayList, PageLayout, RenderCommand } from "./wasm";
import type { GlyphAtlas } from "./glyphAtlas";
import { traceFilledBezier } from "./displayListPainter";

/** Sliding window size: current page ± 2. */
const WINDOW_SIZE = 5;
const WINDOW_BEFORE = 2;

interface CachedPage {
  pageIndex: number;
  canvas: OffscreenCanvas;
  width: number;
  height: number;
}

/**
 * Split a DisplayList into per-page command arrays using the pages metadata.
 * Commands are assigned to a page based on their y-coordinate falling within
 * the page's yOffset..yOffset+height range.
 */
export function splitCommandsByPage(displayList: DisplayList): { commands: RenderCommand[]; layout: PageLayout }[] {
  const pages = displayList.pages;
  if (!pages || pages.length === 0) {
    // No page info — treat entire displayList as one page
    return [
      {
        commands: displayList.commands,
        layout: {
          pageNumber: 1,
          systemIndices: [],
          yOffset: 0,
          height: displayList.height,
        },
      },
    ];
  }

  const result: { commands: RenderCommand[]; layout: PageLayout }[] = pages.map((p) => ({ commands: [], layout: p }));

  for (const cmd of displayList.commands) {
    const [cmdMinY, cmdMaxY] = getCommandYRange(cmd);
    // Assign to every page whose vertical extent overlaps the command's
    // y-range. This is what makes cross-page geometry (slurs that bridge a
    // page break, brackets that span systems, long beam lines, etc.) render
    // correctly: each page's OffscreenCanvas paints its slice, and the
    // out-of-bounds remainder is silently clipped by Canvas 2D.
    let assigned = false;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      const pageTop = page.yOffset;
      const pageBottom = page.yOffset + page.height;
      if (cmdMaxY >= pageTop && cmdMinY < pageBottom) {
        const entry = result[i];
        if (entry) entry.commands.push(cmd);
        assigned = true;
      }
    }
    // If no page matched (e.g. global background), assign to first visible page
    if (!assigned && pages.length > 0) {
      const first = result[0];
      if (first) first.commands.push(cmd);
    }
  }

  return result;
}

/**
 * Extract the [minY, maxY] vertical extent of a render command. Used to
 * decide which page(s) a command belongs to so cross-page geometry (slurs,
 * brackets, long beams) renders on every page it crosses.
 */
function getCommandYRange(cmd: RenderCommand): [number, number] {
  switch (cmd.type) {
    case "DrawLine":
      return [Math.min(cmd.y1, cmd.y2), Math.max(cmd.y1, cmd.y2)];
    case "DrawRect":
      return [cmd.y, cmd.y + cmd.h];
    case "DrawCircle":
      return [cmd.cy - cmd.r, cmd.cy + cmd.r];
    case "DrawEllipse":
      return [cmd.cy - cmd.ry, cmd.cy + cmd.ry];
    case "DrawText":
      return [cmd.y, cmd.y];
    case "DrawGlyph":
      return [cmd.y, cmd.y];
    case "DrawStretchedGlyph":
      // A brace hangs from its baseline, so the span it covers is the `size`
      // above `y` — a page it crosses has to keep it.
      return [cmd.y - cmd.size, cmd.y];
    case "DrawBezier":
      return [Math.min(cmd.y1, cmd.y2, cmd.cy1, cmd.cy2), Math.max(cmd.y1, cmd.y2, cmd.cy1, cmd.cy2)];
    case "DrawQuadratic":
      return [Math.min(cmd.y1, cmd.y2, cmd.cy), Math.max(cmd.y1, cmd.y2, cmd.cy)];
    case "DrawFilledBezier":
      return [
        Math.min(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2, cmd.icy1, cmd.icy2),
        Math.max(cmd.y1, cmd.y2, cmd.ocy1, cmd.ocy2, cmd.icy1, cmd.icy2),
      ];
    case "DrawPolygon": {
      if (cmd.points.length === 0) return [0, 0];
      const ys = cmd.points.map((p) => p[1]);
      return [Math.min(...ys), Math.max(...ys)];
    }
    case "SetOpacity":
      return [0, 0];
  }
}

export class PageCache {
  private cache: Map<number, CachedPage> = new Map();
  private totalPages = 0;
  private displayList: DisplayList | null = null;
  private pageCommands: { commands: RenderCommand[]; layout: PageLayout }[] = [];
  private glyphAtlas: GlyphAtlas | null = null;

  /** Optional painter function override (for testing). */
  private paintFn:
    | ((ctx: OffscreenCanvasRenderingContext2D, commands: RenderCommand[], atlas: GlyphAtlas | null) => void)
    | null = null;

  constructor(glyphAtlas?: GlyphAtlas) {
    if (glyphAtlas) {
      this.glyphAtlas = glyphAtlas;
    }
  }

  /** Set the glyph atlas for optimized rendering. */
  setGlyphAtlas(atlas: GlyphAtlas): void {
    this.glyphAtlas = atlas;
  }

  /** Set a custom paint function (for testing). */
  setPaintFn(
    fn: (ctx: OffscreenCanvasRenderingContext2D, commands: RenderCommand[], atlas: GlyphAtlas | null) => void,
  ): void {
    this.paintFn = fn;
  }

  /**
   * Load a display list and split it by pages.
   * Invalidates the entire cache.
   */
  setDisplayList(displayList: DisplayList): void {
    this.displayList = displayList;
    this.pageCommands = splitCommandsByPage(displayList);
    this.totalPages = this.pageCommands.length;
    this.cache.clear();
  }

  /** Number of pages in the current display list. */
  get pageCount(): number {
    return this.totalPages;
  }

  /**
   * Ensure the 5-page window around currentPage is cached.
   * Evicts pages outside the window.
   */
  ensureWindow(currentPage: number): void {
    if (!this.displayList) return;

    const windowStart = Math.max(0, currentPage - WINDOW_BEFORE);
    const windowEnd = Math.min(this.totalPages - 1, windowStart + WINDOW_SIZE - 1);

    // Evict pages outside window
    for (const [pageIndex] of this.cache) {
      if (pageIndex < windowStart || pageIndex > windowEnd) {
        this.cache.delete(pageIndex);
      }
    }

    // Render pages in the window
    for (let i = windowStart; i <= windowEnd; i++) {
      if (!this.cache.has(i)) {
        this.renderPage(i);
      }
    }
  }

  /**
   * Render a single page to its own OffscreenCanvas.
   */
  private renderPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex >= this.totalPages || !this.displayList) return;

    const pageData = this.pageCommands[pageIndex];
    if (!pageData) return;
    const width = this.displayList.width;
    const height = pageData.layout.height;

    const canvas = new OffscreenCanvas(Math.ceil(width), Math.ceil(height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // White background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    // Translate so page content renders at y=0
    const yOff = pageData.layout.yOffset;
    ctx.translate(0, -yOff);

    if (this.paintFn) {
      this.paintFn(ctx, pageData.commands, this.glyphAtlas);
    } else {
      // Use the imported paint function
      paintCommandsWithAtlas(ctx, pageData.commands, this.glyphAtlas);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    this.cache.set(pageIndex, { pageIndex, canvas, width, height });
  }

  /**
   * Composite cached pages onto the visible canvas.
   */
  compositeToCanvas(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    scrollY: number = 0,
  ): void {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (const [, page] of this.cache) {
      const pageData = this.pageCommands[page.pageIndex];
      if (!pageData) continue;

      const pageTop = pageData.layout.yOffset - scrollY;
      const pageBottom = pageTop + page.height;

      // Skip if not visible
      if (pageBottom < 0 || pageTop > canvasHeight) continue;

      ctx.drawImage(page.canvas, 0, pageTop);
    }
  }

  /** Check if a specific page is cached. */
  isPageCached(pageIndex: number): boolean {
    return this.cache.has(pageIndex);
  }

  /** Get the number of currently cached pages. */
  get cachedPageCount(): number {
    return this.cache.size;
  }

  /** Invalidate the entire cache (e.g. on zoom change). */
  invalidate(): void {
    this.cache.clear();
  }
}

/**
 * Paint a list of commands using the glyph atlas when possible,
 * falling back to direct rendering.
 */
function paintCommandsWithAtlas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  commands: RenderCommand[],
  atlas: GlyphAtlas | null,
): void {
  for (const cmd of commands) {
    if (cmd.type === "DrawGlyph" && atlas?.isBuilt && cmd.rotation === 0) {
      const drawn = atlas.drawGlyph(ctx, cmd.codepoint, cmd.x, cmd.y, cmd.size, cmd.color);
      if (drawn) continue;
    }
    paintSingleCommand(ctx, cmd);
  }
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type FilledBezierCmd = Extract<RenderCommand, { type: "DrawFilledBezier" }>;

function paintFilledBezierCached(ctx: Ctx2D, cmd: FilledBezierCmd): void {
  if (cmd.line_style === 0 || cmd.line_style === undefined) {
    ctx.fillStyle = cmd.color;
    traceFilledBezier(ctx, cmd);
    ctx.fill();
    return;
  }
  const mcx1 = (cmd.ocx1 + cmd.icx1) / 2;
  const mcy1 = (cmd.ocy1 + cmd.icy1) / 2;
  const mcx2 = (cmd.ocx2 + cmd.icx2) / 2;
  const mcy2 = (cmd.ocy2 + cmd.icy2) / 2;
  const thickness = Math.hypot(cmd.ocx1 - cmd.icx1, cmd.ocy1 - cmd.icy1);
  const strokeWidth = Math.max(thickness * 0.5, 1);
  ctx.strokeStyle = cmd.color;
  ctx.lineWidth = strokeWidth;
  if (cmd.line_style === 1) {
    ctx.lineCap = "butt";
    ctx.setLineDash([Math.max(strokeWidth * 2.4, 5), Math.max(strokeWidth * 1.8, 4)]);
  } else if (cmd.line_style === 2) {
    ctx.lineCap = "round";
    ctx.setLineDash([0.001, Math.max(strokeWidth * 2.2, 3.5)]);
  } else {
    ctx.lineCap = "round";
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(cmd.x1, cmd.y1);
  ctx.bezierCurveTo(mcx1, mcy1, mcx2, mcy2, cmd.x2, cmd.y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Paint a single render command (fallback path, same as displayListPainter).
 */
function paintSingleCommand(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cmd: RenderCommand,
): void {
  switch (cmd.type) {
    case "DrawLine":
      ctx.strokeStyle = cmd.color;
      ctx.lineWidth = cmd.width;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.lineTo(cmd.x2, cmd.y2);
      ctx.stroke();
      break;

    case "DrawEllipse":
      ctx.save();
      ctx.translate(cmd.cx, cmd.cy);
      ctx.rotate(cmd.angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, cmd.rx, cmd.ry, 0, 0, Math.PI * 2);
      if (cmd.filled) {
        ctx.fillStyle = cmd.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = cmd.color;
        ctx.lineWidth = Math.max(cmd.rx * 0.05, 1);
        ctx.stroke();
      }
      ctx.restore();
      break;

    case "DrawRect":
      ctx.fillStyle = cmd.color;
      ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
      break;

    case "DrawCircle":
      ctx.fillStyle = cmd.color;
      ctx.beginPath();
      ctx.arc(cmd.cx, cmd.cy, cmd.r, 0, Math.PI * 2);
      ctx.fill();
      break;

    case "DrawText":
      ctx.fillStyle = cmd.color;
      ctx.font = `${cmd.size}px ${cmd.font}`;
      ctx.textAlign = cmd.align;
      ctx.textBaseline = cmd.baseline;
      ctx.fillText(cmd.text, cmd.x, cmd.y);
      break;

    case "DrawGlyph":
      ctx.fillStyle = cmd.color;
      ctx.font = `${cmd.size}px ${cmd.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      if (cmd.rotation !== 0) {
        ctx.save();
        ctx.translate(cmd.x, cmd.y);
        ctx.rotate(cmd.rotation);
        ctx.fillText(String.fromCodePoint(cmd.codepoint), 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(String.fromCodePoint(cmd.codepoint), cmd.x, cmd.y);
      }
      break;

    case "DrawStretchedGlyph":
      ctx.fillStyle = cmd.color;
      ctx.font = `${cmd.size}px ${cmd.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.save();
      ctx.translate(cmd.x, cmd.y);
      ctx.scale(cmd.scale_x, 1);
      ctx.fillText(String.fromCodePoint(cmd.codepoint), 0, 0);
      ctx.restore();
      break;

    case "DrawBezier":
      ctx.strokeStyle = cmd.color;
      ctx.lineWidth = cmd.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.bezierCurveTo(cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x2, cmd.y2);
      ctx.stroke();
      break;

    case "DrawQuadratic":
      ctx.strokeStyle = cmd.color;
      ctx.lineWidth = cmd.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cmd.x1, cmd.y1);
      ctx.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x2, cmd.y2);
      ctx.stroke();
      break;

    case "DrawFilledBezier":
      paintFilledBezierCached(ctx, cmd);
      break;

    case "DrawPolygon": {
      const pts = cmd.points;
      if (pts.length >= 3) {
        ctx.fillStyle = cmd.color;
        ctx.beginPath();
        const first = pts[0];
        if (first) ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < pts.length; i++) {
          const pt = pts[i];
          if (pt) ctx.lineTo(pt[0], pt[1]);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
}

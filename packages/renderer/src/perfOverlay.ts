/**
 * Performance debug overlay for Canvas rendering.
 *
 * Tracks paint timing and FPS, renders a semi-transparent overlay
 * in the top-right corner of the canvas showing:
 * - Current FPS (exponential moving average)
 * - Last paint time in milliseconds
 * - Canvas resolution
 *
 * Enable via URL parameter: `?perf=1`
 * Or call `enablePerfOverlay()` from the browser console.
 */

/** Check if perf overlay is enabled via env var, URL param, or global flag. */
export function isPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as Record<string, unknown>).__VIRITURA_PERF__) return true;
  try {
    if (new URLSearchParams(window.location.search).has("perf")) return true;
  } catch {
    /* ignore */
  }
  // Vite injects import.meta.env at build time; check at call site via the
  // global that the editor app sets from VITE_PERF_OVERLAY.
  if ((window as unknown as Record<string, unknown>).__VIRITURA_PERF_ENV__ === true) return true;
  return false;
}

/** Enable perf overlay programmatically (callable from browser console). */
export function enablePerfOverlay(): void {
  (window as unknown as Record<string, unknown>).__VIRITURA_PERF__ = true;
  window.dispatchEvent(new Event("viritura:perf-toggle"));
}

/** Disable perf overlay. */
export function disablePerfOverlay(): void {
  delete (window as unknown as Record<string, unknown>).__VIRITURA_PERF__;
  window.dispatchEvent(new Event("viritura:perf-toggle"));
}

/** Check if tile caching is disabled (direct render mode for comparison). */
export function isTileCacheDisabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as Record<string, unknown>).__VIRITURA_NO_TILES__ === true;
}

/** Disable tile caching (direct render every frame). Call from browser console. */
export function disableTileCache(): void {
  (window as unknown as Record<string, unknown>).__VIRITURA_NO_TILES__ = true;

  console.log("[Viritura] Tile cache DISABLED. Rendering directly every frame.");
}

/** Re-enable tile caching. */
export function enableTileCache(): void {
  delete (window as unknown as Record<string, unknown>).__VIRITURA_NO_TILES__;

  console.log("[Viritura] Tile cache ENABLED.");
}

// Expose to browser console
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).enablePerfOverlay = enablePerfOverlay;
  (window as unknown as Record<string, unknown>).disablePerfOverlay = disablePerfOverlay;
  (window as unknown as Record<string, unknown>).disableTileCache = disableTileCache;
  (window as unknown as Record<string, unknown>).enableTileCache = enableTileCache;
  // Tiles enabled by default — hybrid approach uses tiles for scroll/zoom,
  // direct render for edit repaints (forceDirect=true in paintNow).
  // Disable via console: disableTileCache()
}

/** Measure-level patch info for incremental WASM layout. */
export interface PatchInfo {
  /** Indices of changed global measures. */
  changedGlobalMeasures: number[];
  /** Map of partIndex → changed measure indices. */
  changedPartMeasures: Map<number, number[]>;
  /** True if parts/layouts/structural elements changed (use full re-parse). */
  structuralChange: boolean;
  /** Root time-signature policy changed without changing score structure. */
  timeSignatureSettingsChange?: boolean;
  /**
   * Pre-built WASM patch JSON ({ globalMeasures, partMeasures, timeSignatures }) assembled
   * directly from the delta serializer's per-measure caches. When present, the
   * layout path sends this straight to the engine, skipping a full-score
   * JSON.parse + re-extract. O(changed measures) instead of O(score size).
   */
  prebuiltPatchJson?: string;
  /** Main-thread-only lazy full document used if the incremental call fails.
   * Patch success never invokes it. */
  fallbackJson?: () => string;
}

/** Tracks FPS and paint timing for a single canvas. */
export class PerfTracker {
  private lastFrameTime = 0;
  private fps = 0;
  private paintMs = 0;
  private alpha = 0.1; // EMA smoothing factor

  /** Pipeline phase timings (ms), set externally. */
  serializeMs = 0;
  wasmLayoutMs = 0;
  spatialIndexMs = 0;
  commandProcessingMs = 0;
  /** Timestamp (performance.now()) set when an edit begins. */
  private editStartTime = 0;
  /** Total ms from edit start to paint end. */
  editToPaintMs = 0;
  /** Total ms from input event to paint end. */
  inputToPaintMs = 0;
  /** Score complexity info string (e.g. "8m × 4p") */
  scoreComplexity = "";

  // ── Layout cache metrics (from LayoutEngine.cacheStats()) ──
  /** Measures whose natural width was served from cache (last layout pass). */
  cacheHits = 0;
  /** Measures that needed full layout_measure() recomputation. */
  cacheMisses = 0;

  // ── Tile cache metrics (from TileCache) ──
  /** Tiles blitted from cache in the last paint frame. */
  tilesCached = 0;
  /** Tiles newly rendered in the last paint frame. */
  tilesRendered = 0;
  /** Whether the paint used tiles or direct render. */
  usedTiles = false;
  /** Whether the tile cache is globally disabled (disableTileCache()). Distinct
   *  from a single frame painting directly (zoom gesture, spread mode, forced
   *  repaint), which is what `usedTiles === false` indicates. */
  tileCacheDisabled = false;

  /** Bounding boxes of interactive buttons from the last drawOverlay call (in CSS pixels). */
  private buttons: Array<{ x: number; y: number; w: number; h: number; action: () => void }> = [];

  /** Whether the overlay is collapsed (shows only FPS + Input→Paint). */
  private collapsed = true;

  /**
   * Callback for synchronous layout+paint from updateScore.
   * Set by ScoreCanvas, called by DocumentContext to bypass React scheduling.
   * @param mnxJson Full MNX JSON string (always valid, always complete).
   * @param patchInfo Optional — when present, indicates which measures changed
   *   so the WASM engine can use the patch API instead of full re-parse.
   * @returns A promise that resolves once the off-thread layout has resolved
   *   and painted, so a caller can coalesce a burst of edits onto the single
   *   layout worker (fire the next layout only when the previous one is done).
   */
  fastLayoutCallback: ((mnxJson: string, patchInfo?: PatchInfo) => void | Promise<void>) | null = null;

  /** Mark the start of an edit action (call from updateScore). */
  markEditStart(): void {
    this.editStartTime = performance.now();
  }

  /** Call before painting. Returns a function to call after painting is done. */
  beginFrame(): () => void {
    const start = performance.now();
    return () => {
      const end = performance.now();
      this.paintMs = end - start;

      if (this.editStartTime > 0) {
        this.editToPaintMs = end - this.editStartTime;
        this.editStartTime = 0;
      }

      if (this.lastFrameTime > 0) {
        const delta = end - this.lastFrameTime;
        const instantFps = delta > 0 ? 1000 / delta : 0;
        this.fps = this.fps === 0 ? instantFps : this.fps * (1 - this.alpha) + instantFps * this.alpha;
      }
      this.lastFrameTime = end;
    };
  }

  /**
   * Handle a click event on the canvas. Returns true if a perf overlay button was hit.
   * Coordinates should be in CSS pixels relative to the canvas element.
   */
  handleClick(cssX: number, cssY: number): boolean {
    for (const btn of this.buttons) {
      if (cssX >= btn.x && cssX <= btn.x + btn.w && cssY >= btn.y && cssY <= btn.y + btn.h) {
        btn.action();
        return true;
      }
    }
    return false;
  }

  private buildMetricsLines(extra: string | undefined): string[] {
    const cacheTotal = this.cacheHits + this.cacheMisses;
    const cacheRatio = cacheTotal > 0 ? ((this.cacheHits / cacheTotal) * 100).toFixed(0) : "--";
    // "Tiles: N✓ M✗" when this frame blitted/rendered tiles; "Direct" when this
    // frame painted directly (zoom gesture, spread view, or forced repaint);
    // "Tiles: DISABLED" only when the global kill-switch is on.
    const tileInfo = this.tileCacheDisabled
      ? `Tiles: DISABLED`
      : this.usedTiles
        ? `Tiles: ${this.tilesCached}✓ ${this.tilesRendered}✗`
        : `Direct (no tiles this frame)`;
    if (this.collapsed) {
      return [`FPS: ${this.fps.toFixed(0)}`, `Input\u2192Paint: ${this.inputToPaintMs.toFixed(0)}ms`];
    }
    return [
      `FPS: ${this.fps.toFixed(0)}`,
      `Paint: ${this.paintMs.toFixed(1)}ms`,
      `Cmd proc: ${this.commandProcessingMs.toFixed(1)}ms`,
      `Serialize: ${this.serializeMs.toFixed(1)}ms`,
      `WASM layout: ${this.wasmLayoutMs.toFixed(1)}ms`,
      `Layout cache: ${this.cacheHits}/${cacheTotal} (${cacheRatio}%)`,
      `Spatial idx: ${this.spatialIndexMs.toFixed(1)}ms`,
      `Edit\u2192Paint: ${this.editToPaintMs.toFixed(0)}ms`,
      `Input\u2192Paint: ${this.inputToPaintMs.toFixed(0)}ms`,
      tileInfo,
      ...(this.scoreComplexity ? [`Score: ${this.scoreComplexity}`] : []),
      ...(extra ? [extra] : []),
    ];
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bgColor: string,
    fontSize: number,
    action: () => void,
  ): void {
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `${fontSize - 1}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2);
    this.buttons.push({ x, y, w, h, action });
  }

  /** Render the debug overlay on a canvas context. */
  drawOverlay(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    opts?: { extra?: string; leftOffset?: number },
  ): void {
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const tilesOff = isTileCacheDisabled();
    const fontSize = 11;
    const lineHeight = 14;
    const padding = 6;
    const boxW = 180;
    const buttonH = 16;
    const buttonGap = 4;

    const lines = this.buildMetricsLines(opts?.extra);

    const numButtons = this.collapsed ? 1 : 2;
    const boxH = lines.length * lineHeight + padding * 2 + numButtons * (buttonH + buttonGap);
    // Offset horizontally so the overlay clears a floating left panel instead
    // of hiding behind it. Caller passes the panel's right edge (CSS px).
    const boxX = opts?.leftOffset ?? 8;
    const boxY = 8;

    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();

    // Text lines
    ctx.fillStyle = "#0f0";
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, boxX + padding, boxY + padding + i * lineHeight);
    }

    this.buttons = [];
    let nextBtnY = boxY + padding + lines.length * lineHeight + buttonGap;
    const btnX = boxX + padding;
    const btnW = boxW - padding * 2;

    // Collapse/expand toggle button
    const collapseLabel = this.collapsed ? "[+ Expand]" : "[- Collapse]";
    this.drawButton(ctx, collapseLabel, btnX, nextBtnY, btnW, buttonH, "rgba(100,100,100,0.6)", fontSize, () => {
      this.collapsed = !this.collapsed;
    });
    nextBtnY += buttonH + buttonGap;

    // Tile toggle button (only when expanded)
    if (!this.collapsed) {
      const btnLabel = tilesOff ? "[Enable Tiles]" : "[Disable Tiles]";
      const btnBg = tilesOff ? "rgba(200,50,50,0.6)" : "rgba(50,150,50,0.6)";
      this.drawButton(ctx, btnLabel, btnX, nextBtnY, btnW, buttonH, btnBg, fontSize, () => {
        if (tilesOff) enableTileCache();
        else disableTileCache();
      });
    }

    ctx.restore();
  }
}

/** Shared global PerfTracker instance. */
let _globalTracker: PerfTracker | null = null;

/** Get or create the global PerfTracker singleton. */
export function getGlobalPerfTracker(): PerfTracker {
  if (!_globalTracker) _globalTracker = new PerfTracker();
  return _globalTracker;
}

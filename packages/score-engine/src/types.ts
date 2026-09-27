/**
 * Public types for @viritura/score-engine.
 *
 * These are self-contained: nothing here re-exports internal renderer types,
 * so the published declarations stay small and the engine can change its
 * internal display-list representation without breaking consumers.
 *
 * Coordinate system: all geometry is in display-list units (CSS pixels at
 * zoom 1). Geometry that belongs to a page is **page-local** — `y = 0` is the
 * top of that page. Unpaged (horizon) layouts have exactly one page.
 */

declare const displayListBrand: unique symbol;

/**
 * Opaque handle to a computed layout. Produced by `engine.layout()` or a
 * `LayoutWorker`; pass it back to the engine to paint or query geometry.
 */
export interface DisplayList {
  readonly [displayListBrand]: true;
  /** Page width (paged) or full score width (unpaged). */
  readonly width: number;
  /** Total height of all pages stacked without gaps. */
  readonly height: number;
  /** Number of pages (1 for unpaged layouts). */
  readonly pageCount: number;
  /** True when the layout was computed with page geometry. */
  readonly paged: boolean;
}

/** Axis-aligned rectangle in display-list units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A part in score order with its stable identifier. */
export interface PartInfo {
  /**
   * Stable part ID: the source MNX `parts[n].id` when present, otherwise the
   * positional fallback `#<n>` (0-based). Deterministic across calls.
   */
  readonly id: string;
  /** 0-based index in MNX `parts[]`. */
  readonly index: number;
  /** Display name (may be empty). */
  readonly name: string;
}

/** Score metadata derived from MNX without running layout. */
export interface ScoreInfo {
  readonly parts: readonly PartInfo[];
  readonly measureCount: number;
  /** Entries of MNX `scores[]`, selectable via `LayoutOptions.scoreIndex`. */
  readonly scores: ReadonlyArray<{ readonly index: number; readonly name: string }>;
}

/** Engine build identity. */
export interface EngineVersion {
  /** Rust layout engine version reported by the loaded WASM module. */
  readonly engine: string;
  /** `@viritura/score-engine` package version. */
  readonly package: string;
  /** Viritura commit the bundle was built from, when known. */
  readonly commit: string | null;
}

/** Explicit page geometry for paged layout. */
export interface LayoutPageSetup {
  /** Page height in display-list units. */
  height: number;
  /** Page margins in display-list units. */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

/** Engraving inputs for `engine.layout()`. Changing any of these reflows the music. */
export interface LayoutOptions {
  /** Page width in display-list units. `0` selects unpaged (horizon) layout. */
  pageWidth: number;
  /** Staff space in display-list units. Default 7. */
  spatium?: number;
  /** Zero-based index into MNX `scores[]`. Default 0. */
  scoreIndex?: number;
  /** Page geometry. Omit for the engine's default page proportions. */
  pageSetup?: LayoutPageSetup;
}

/**
 * Options for `engine.paint()`.
 *
 * `paint` draws ink only into whatever transform the caller has set on the
 * context (hi-DPI scale, zoom, scroll). It never clears the canvas.
 */
export interface PaintOptions {
  /** Zero-based page to paint. Default 0. */
  page?: number;
  /** Page-local rectangle to paint; commands entirely outside it are skipped. */
  region?: Rect;
  /** Colour substituted for default (black) ink, e.g. for dark themes. Explicitly coloured elements keep their colour. */
  ink?: string;
  /** Fill painted under the page before the ink. Default none (transparent). */
  background?: string | null;
}

/** Options for `engine.toSvg()`. */
export interface SvgOptions {
  /** Zero-based page to export. Default 0. */
  page?: number;
  /** Colour substituted for default (black) ink. */
  ink?: string;
}

/** Options for `loadEngine()`. */
export interface LoadEngineOptions {
  /**
   * Base URL containing `wasm/` and `fonts/`. Defaults to the directory of
   * the prebuilt bundle, or the page's asset base inside Viritura's own apps.
   * Sandboxed hosts (VS Code webviews) pass their rewritten asset URL here.
   */
  assetBaseUrl?: string;
  /**
   * Load the bundled Libertinus Serif text face as `Viritura Serif`. Default
   * true. Pass false to use the page's generic `serif` family (or register a
   * `Viritura Serif` face yourself). The Bravura music font is always loaded:
   * layout is measured with Bravura's metrics, so it cannot be replaced.
   */
  textFont?: boolean;
}

/** Options for `engine.createLayoutWorker()`. */
export interface LayoutWorkerOptions {
  /** URL of the engine's worker script. Defaults to `score-engine.worker.js` in the asset base. */
  url?: string | URL;
}

/** Layout computed off the main thread. */
export interface LayoutWorker {
  /** Same contract as `engine.layout()`, resolved asynchronously. */
  layout(mnx: string | object, opts: LayoutOptions): Promise<DisplayList>;
  /** Terminate the worker. Pending layouts reject. */
  dispose(): void;
}

/** A page of a display list. */
export interface PageGeometry {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** Offset of this page within the gap-free vertical page stack. */
  readonly offsetY: number;
}

/** Page-by-page sizing derived from a display list. */
export interface ScoreMeasurements {
  readonly pageCount: number;
  readonly pages: readonly PageGeometry[];
  /** Sum of all page heights. */
  readonly totalHeight: number;
  /** Widest page. */
  readonly maxPageWidth: number;
  /** Parts present in the layout, in score order. */
  readonly parts: readonly PartInfo[];
}

/** A system (line of music) on a page. Page-local. */
export interface SystemGeometry {
  readonly index: number;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One measure on one staff. Page-local. */
export interface MeasureGeometry {
  /** 0-based measure index in the score. */
  readonly index: number;
  /** Source measure ID when authored. */
  readonly measureId?: string;
  readonly partId: string;
  /** Visual staff index, unique per rendered staff. */
  readonly staffIndex: number;
  readonly systemIndex: number;
  readonly page: number;
  readonly x: number;
  /** Top staff line. */
  readonly y: number;
  readonly width: number;
  /** Staff height (four staff spaces for a five-line staff). */
  readonly height: number;
  /** Start of the rhythmic content after clef/key/time. */
  readonly contentX: number;
  /** Measure length in quarter-note beats. */
  readonly totalBeats: number;
}

/**
 * Unpaged (horizon) paper rectangle around the music, plus the vertical extent
 * a viewport needs to centre it.
 */
export interface HorizonPaper extends Rect {
  readonly contentHeight: number;
}

/** A musical position: global quarter-note beat, or measure + beat within it. */
export type ScorePosition =
  | { readonly beat: number; readonly partId?: string }
  | { readonly measureIndex: number; readonly beat: number; readonly partId?: string };

/** Where a musical position lands on a single staff. Page-local. */
export interface CanvasBeatPosition {
  readonly page: number;
  readonly x: number;
  /** Top staff line. */
  readonly y: number;
  readonly height: number;
}

/** Vertical cursor spanning the whole system at a position. Page-local. */
export interface PlayheadGeometry {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly systemIndex: number;
}

/** Result of `engine.canvasToBeat()`. */
export interface CanvasBeatHit {
  /** Global quarter-note beat in visual (unexpanded) measure order. */
  readonly beat: number;
  readonly measureIndex: number;
  readonly partId: string;
}

/** Options for `TileRenderer.paint()`. */
export interface TilePaintOptions {
  /** Horizontal scroll in display-list units. */
  scrollX: number;
  /** Vertical scroll in display-list units. */
  scrollY: number;
  zoom: number;
  /** Paper fill drawn behind the music. Default none. */
  background?: string | null;
  /** Colour substituted for default (black) ink. */
  ink?: string;
}

/**
 * Cached, incremental painter for very large unpaged layouts: renders the
 * visible viewport from reusable tiles instead of repainting every command.
 */
export interface TileRenderer {
  /**
   * Paint the visible viewport into `canvas` (sized by the caller in device
   * pixels). Returns true when tiles are still pending and another frame
   * should be requested.
   */
  paint(canvas: HTMLCanvasElement, displayList: DisplayList, opts: TilePaintOptions): boolean;
  /** Drop cached tiles (e.g. after a theme change). */
  invalidate(): void;
}

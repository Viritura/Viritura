/**
 * Public types re-exported from @viritura/score-engine.
 *
 * Today these are pass-throughs of the renderer's internal types. Keeping
 * them aliased through this module means we can swap implementations
 * (e.g. introduce an opaque `DisplayList` wrapper) in a later major
 * version without breaking consumers.
 */

import type {
  DisplayList as RendererDisplayList,
  RenderCommand as RendererRenderCommand,
  PageLayout as RendererPageLayout,
  BoundingBox as RendererBoundingBox,
  MeasureBounds as RendererMeasureBounds,
  ScoreInfo as RendererScoreInfo,
} from "@viritura/renderer";

/** Opaque display list produced by `engine.layout()`. */
export type DisplayList = RendererDisplayList;

/** Single render primitive; consumers usually treat `DisplayList` as opaque. */
export type RenderCommand = RendererRenderCommand;

/** Per-page layout metadata (origin + size). */
export type PageLayout = RendererPageLayout;

/** Axis-aligned bounding box in display-list coordinates. */
export type BoundingBox = RendererBoundingBox;

/** Layout bounds for a single measure. */
export type MeasureBounds = RendererMeasureBounds;

/** Top-level score info derived from MNX without running layout. */
export type ScoreInfo = RendererScoreInfo;

/** Options for `engine.layout()`. */
export interface LayoutPageSetup {
  /** Page height in the same display-list units as `pageWidth`. */
  height: number;
  /** Page margins in display-list units. */
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface LayoutOptions {
  /** Page width in CSS pixels. */
  pageWidth: number;
  /** Staff space size in CSS pixels. Default 7. */
  spatium?: number;
  /** Optional zero-based score (layout) index for multi-layout MNX. */
  scoreIndex?: number;
  /** Optional page geometry. Omit for the engine's unpaged/default layout. */
  pageSetup?: LayoutPageSetup;
}

/** Options for `engine.paint()`. */
export interface PaintOptions {
  /** Zero-based page index to paint (default 0). */
  page?: number;
  /** Display zoom (default 1.0). The caller is responsible for canvas hi-DPI scaling. */
  zoom?: number;
  /** Horizontal scroll offset in score coordinates (default 0). */
  scrollX?: number;
  /** Vertical scroll offset in score coordinates (default 0). */
  scrollY?: number;
}

/** Options for `loadEngine()`. */
export interface LoadEngineOptions {
  /**
   * Base URL containing `wasm/` and `fonts/` subdirectories. Useful for
   * sandboxed hosts such as VS Code webviews that must rewrite local asset
   * paths before browser code can fetch them.
   */
  assetBaseUrl?: string;
}

/** Page-by-page output of `engine.measure()`. */
export interface ScoreMeasurements {
  /** Number of pages in the display list. */
  pageCount: number;
  /** Per-page width/height in CSS pixels. */
  pageSizes: ReadonlyArray<{ readonly width: number; readonly height: number }>;
  /** Sum of all page heights — useful for vertical-flow viewports. */
  totalHeight: number;
  /** Maximum page width (for centering / horizontal scrolling). */
  maxPageWidth: number;
  /** Stable part identifiers, in score order. */
  partIds: readonly string[];
}

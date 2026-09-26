/**
 * @viritura/score-engine — framework-free music notation rendering kernel.
 *
 * MNX in; layout, ink-only Canvas painting, SVG, geometry queries and a
 * playback timeline out. Page presentation (paper, zoom, scrolling, view
 * modes) belongs to `@viritura/score-viewer`.
 *
 * ```ts
 * import { loadEngine } from "@viritura/score-engine";
 *
 * const engine = await loadEngine();
 * const dl = engine.layout(mnx, { pageWidth: 800 });
 * const ctx = canvas.getContext("2d")!;
 * ctx.fillStyle = "#fff";
 * ctx.fillRect(0, 0, canvas.width, canvas.height);
 * engine.paint(ctx, dl, { page: 0 });
 * ```
 */

export { loadEngine, isEngineReady } from "./engine";
export type { Engine } from "./engine";
export { EngineLoadError, ParseError, LayoutError } from "./errors";
export type {
  CanvasBeatHit,
  CanvasBeatPosition,
  DisplayList,
  EngineVersion,
  HorizonPaper,
  LayoutOptions,
  LayoutPageSetup,
  LayoutWorker,
  LayoutWorkerOptions,
  LoadEngineOptions,
  MeasureGeometry,
  PageGeometry,
  PaintOptions,
  PartInfo,
  PlayheadGeometry,
  Rect,
  ScoreInfo,
  ScoreMeasurements,
  ScorePosition,
  SvgOptions,
  SystemGeometry,
  TilePaintOptions,
  TileRenderer,
} from "./types";
export type { DynamicMark, TempoSegment, TimedEvent, Timeline, TimelineOptions } from "./timeline";

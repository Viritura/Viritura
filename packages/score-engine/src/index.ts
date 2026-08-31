/**
 * @viritura/score-engine — public, framework-free score rendering API.
 *
 * Browser-only (Canvas 2D). Pairs with @viritura/score-viewer-react for a
 * drop-in React component, or use directly for vanilla JS / docs sites.
 *
 * Quick start:
 *
 * ```ts
 * import { loadEngine } from "@viritura/score-engine";
 *
 * const engine = await loadEngine();
 * const dl = engine.layout(mnxJson, { pageWidth: 800 });
 * engine.paint(canvas.getContext("2d")!, dl, { page: 0 });
 * ```
 *
 * See https://viritura.com/docs/score-engine for the full guide.
 */

export { loadEngine, isEngineReady, Engine } from "./engine";
export { EngineLoadError, ParseError, LayoutError } from "./errors";
export type {
  DisplayList,
  RenderCommand,
  PageLayout,
  BoundingBox,
  MeasureBounds,
  ScoreInfo,
  LayoutPageSetup,
  LayoutOptions,
  PaintOptions,
  LoadEngineOptions,
  ScoreMeasurements,
} from "./types";
export type {
  Timeline,
  TimelineOptions,
  TimedEvent,
  TempoSegment,
  DynamicMark,
  CanvasBeatPosition,
  CanvasBeatHit,
} from "./timeline";

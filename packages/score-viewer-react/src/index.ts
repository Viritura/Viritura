export { ScoreView, useScoreView } from "./ScoreView";
export type {
  ScorePageMargins,
  ScorePagePosition,
  ScoreSpreadFirstPage,
  ScoreViewMode,
  ScoreViewProps,
} from "./ScoreView";
export { ScoreViewer } from "./ScoreViewer";
export type { ScoreViewerProps } from "./ScoreViewer";
export { ScoreViewerControls } from "./ScoreViewerControls";
export type {
  ScoreFitMode,
  ScoreViewerControlOptions,
  ScoreViewerControlsProps,
  ScoreViewerControlSurface,
  ScoreViewerScoreOption,
} from "./ScoreViewerControls";
export { useScoreEngine } from "./useScoreEngine";
export type { UseScoreEngineResult } from "./useScoreEngine";

// Re-export the engine surface so consumers only need one import.
export { loadEngine, isEngineReady, Engine, EngineLoadError, ParseError, LayoutError } from "@viritura/score-engine";
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
  Timeline,
  TimelineOptions,
  TimedEvent,
  TempoSegment,
  DynamicMark,
  CanvasBeatPosition,
  CanvasBeatHit,
} from "@viritura/score-engine";

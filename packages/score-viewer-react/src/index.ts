export { ScoreView } from "./ScoreView";
export { useScoreView } from "./scoreViewContext";
export type {
  ScoreContentAlign,
  ScorePageMargins,
  ScorePagePosition,
  ScoreSpreadFirstPage,
  ScoreViewMode,
} from "@viritura/score-viewer";
export type { ScoreViewProps } from "./scoreViewProps";
export { ScoreViewer } from "./ScoreViewer";
export type { ScoreViewerProps } from "./ScoreViewer";
export { ScoreViewerControls } from "./ScoreViewerControls";
export type {
  ScoreFitMode,
  ScoreViewerControlOptions,
  ScoreViewerControlsProps,
  ScoreViewerControlSurface,
  ScoreViewerPageSizeOption,
  ScoreViewerScoreOption,
  ScoreViewerStaffSizeOption,
} from "./ScoreViewerControls";
export { useScoreEngine } from "./useScoreEngine";
export type { UseScoreEngineResult } from "./useScoreEngine";

// Re-export the engine surface so consumers only need one import.
export { loadEngine, isEngineReady, EngineLoadError, ParseError, LayoutError } from "@viritura/score-engine";
export type {
  Engine,
  DisplayList,
  PageGeometry,
  Rect,
  PlayheadGeometry,
  ScorePosition,
  SystemGeometry,
  MeasureGeometry,
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

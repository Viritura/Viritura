import type { ChordSymbol, RhythmicPosition } from "@viritura/core";
import type { DisplayList, MeasureBounds, PlayheadPosition } from "@viritura/renderer";
import type { ViewportInfo } from "../ScoreCanvas";

export interface TimedChord {
  measureIndex: number;
  symbol: ChordSymbol;
  elementId?: string;
}

export interface TrackPoint {
  measureIndex: number;
  beat: number;
  /** Horizontal position in engine score coordinates, not viewport CSS pixels. */
  x: number;
  position?: RhythmicPosition;
}

export interface TrackSystem {
  id: number;
  measures: MeasureBounds[];
  sourceTop: number;
  musicHeight: number;
  width: number;
}

export interface ChordTrackProps {
  displayList: DisplayList;
  viewport: ViewportInfo;
  playhead: PlayheadPosition | null;
  onRevealPoint: (point: TrackPoint) => void;
  onPanBy: (deltaX: number) => void;
  safeAreaLeft?: number;
}

export interface ChordDragPreview {
  source: TimedChord;
  target: TrackPoint | null;
  valid: boolean;
  fineGrid: boolean;
}

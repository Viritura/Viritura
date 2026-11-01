import { useEffect, type RefObject } from "react";
import { trackBeatToX } from "./trackGeometry";
import { paintChordLane } from "./trackLanePainter";
import type { ChordDragPreview, ChordTrackProps, TimedChord, TrackPoint, TrackSystem } from "./types";

interface PaintArgs {
  canvas: RefObject<HTMLCanvasElement | null>;
  system: TrackSystem | null;
  size: { width: number; height: number };
  visible: boolean;
  chords: readonly TimedChord[];
  points: TrackPoint[];
  active: TrackPoint | null;
  railScoreY: number;
  playhead: ChordTrackProps["playhead"];
  theme: string;
  scale: number;
  viewport: ChordTrackProps["viewport"];
  headerRight: number;
  dragPreview: ChordDragPreview | null;
}

export function useChordTrackPaint({
  canvas,
  system,
  size,
  visible,
  chords,
  points,
  active,
  railScoreY,
  playhead,
  theme,
  scale,
  viewport,
  headerRight,
  dragPreview,
}: PaintArgs): void {
  useEffect(() => {
    const element = canvas.current;
    if (!element || !system || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.ceil(size.width * dpr);
    element.height = Math.ceil(size.height * dpr);
    const ctx = element.getContext("2d");
    if (!ctx) throw new Error("Chord track requires Canvas 2D");
    if (!visible) return;
    const laneZoom = viewport.zoom * scale;
    ctx.setTransform(
      dpr * laneZoom,
      0,
      0,
      dpr * laneZoom,
      -viewport.scrollX * viewport.zoom * dpr,
      -viewport.scrollY * viewport.zoom * dpr,
    );
    const css = getComputedStyle(element);
    const measure = playhead ? system.measures.find((entry) => entry.index === playhead.measureIndex) : undefined;
    paintChordLane(ctx, {
      system,
      chords,
      points: points.map((point) => ({ ...point, x: point.x / scale })),
      active: active ? { ...active, x: active.x / scale } : null,
      railY: railScoreY / scale,
      background: css.getPropertyValue("--surface").trim() || "#f7f9f8",
      ink: css.getPropertyValue("--text").trim() || "#243e36",
      playheadX: measure && playhead ? trackBeatToX(measure, playhead.beat) : undefined,
      drawHeader: false,
      clipLeft: (headerRight / viewport.zoom + viewport.scrollX) / scale,
      dragPreview: dragPreview
        ? {
            ...dragPreview,
            target: dragPreview.target ? { ...dragPreview.target, x: dragPreview.target.x / scale } : null,
          }
        : null,
    });
  }, [
    canvas,
    system,
    size,
    visible,
    chords,
    points,
    active,
    railScoreY,
    playhead,
    theme,
    scale,
    viewport,
    headerRight,
    dragPreview,
  ]);
}

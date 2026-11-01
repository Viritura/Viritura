import { paintCommand, paintInkCommands, type DisplayList } from "@viritura/renderer";
import { LANE_HEIGHT, paintChordLane, type ChordDragPreview } from "../ChordTrack";
import type { PrototypeChord, TrackPoint, TrackSystem } from "./types";

interface PaintTrackArgs {
  canvas: HTMLCanvasElement;
  displayList: DisplayList;
  system: TrackSystem;
  chords: readonly PrototypeChord[];
  points: TrackPoint[];
  active: TrackPoint | null;
  zoom: number;
  viewMode: "horizon" | "page";
  headerRight: number;
  dragPreview: ChordDragPreview | null;
}

export function laneTop(system: TrackSystem, viewMode: "horizon" | "page"): number {
  return viewMode === "horizon" ? system.musicHeight + 12 : 12;
}

export function paintTrackSystem({
  canvas,
  displayList,
  system,
  chords,
  points,
  active,
  zoom,
  viewMode,
  headerRight,
  dragPreview,
}: PaintTrackArgs): void {
  const height = system.musicHeight + LANE_HEIGHT + 24;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(system.width * zoom * dpr);
  canvas.height = Math.ceil(height * zoom * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Chord track prototype requires Canvas 2D");
  ctx.scale(zoom * dpr, zoom * dpr);
  const musicY = viewMode === "horizon" ? 0 : LANE_HEIGHT + 24;
  const railY = laneTop(system, viewMode);
  ctx.fillStyle = "#faf7ef";
  ctx.fillRect(0, 0, system.width, viewMode === "horizon" ? system.musicHeight : height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, musicY, system.width, system.musicHeight);
  ctx.clip();
  ctx.translate(0, musicY - system.sourceTop);
  paintInkCommands(ctx, displayList.commands, (command) => paintCommand(ctx, command));
  ctx.restore();

  paintChordLane(ctx, {
    system,
    chords,
    points,
    active,
    railY,
    background: viewMode === "horizon" ? "rgba(247, 249, 248, 0.92)" : "rgba(70, 126, 113, 0.07)",
    drawHeader: false,
    clipLeft: headerRight / zoom,
    dragPreview,
  });
}

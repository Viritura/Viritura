import { formatChordSymbolText, resolveChordSymbol } from "@viritura/core";
import { canvasTextFont, paintBeatRuler, paintCommand } from "@viritura/renderer";
import { LANE_HEIGHT, pointChord, positionTrackChords, sameTrackPoint } from "./trackGeometry";
import type { ChordDragPreview, TimedChord, TrackPoint, TrackSystem } from "./types";

interface PaintLaneArgs {
  system: TrackSystem;
  chords: readonly TimedChord[];
  points: TrackPoint[];
  active: TrackPoint | null;
  railY: number;
  background: string;
  ink?: string;
  playheadX?: number;
  drawHeader?: boolean;
  clipLeft?: number;
  dragPreview?: ChordDragPreview | null;
}

function fitChordLabel(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let shortened = text;
  while (shortened.length > 0 && ctx.measureText(`${shortened}...`).width > width) shortened = shortened.slice(0, -1);
  return `${shortened}...`;
}

function paintMeasures(ctx: CanvasRenderingContext2D, { system, points, active, railY }: PaintLaneArgs): void {
  for (const measure of system.measures) {
    ctx.strokeStyle = "rgba(74, 104, 96, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(measure.x, railY + 10);
    ctx.lineTo(measure.x, railY + LANE_HEIGHT - 10);
    ctx.stroke();
    ctx.fillStyle = "#66746f";
    ctx.font = "10px sans-serif";
    ctx.fillText(String(measure.index + 1), measure.x + 5, railY + 14);
    const ticks = points
      .filter((point) => point.measureIndex === measure.index)
      .map((point) => ({
        ...point,
        isEventOnset: measure.beatAnchors.some(([beat]) => Math.abs(beat - point.beat) < 1e-9),
        active: sameTrackPoint(point, active),
      }));
    paintBeatRuler(ctx, ticks, { rulerY: railY + 52, spatium: 13, inactiveColor: "rgb(74, 104, 96)" });
  }
}

export function paintChordLane(ctx: CanvasRenderingContext2D, args: PaintLaneArgs): void {
  const {
    system,
    chords,
    active,
    railY,
    background,
    ink = "#243e36",
    playheadX,
    drawHeader = true,
    clipLeft,
    dragPreview,
  } = args;
  const first = system.measures[0];
  const last = system.measures[system.measures.length - 1];
  if (!first || !last) return;
  const left = first.x - 96;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(left, railY, last.x + last.width - left, LANE_HEIGHT, 8);
  ctx.fill();
  if (drawHeader) {
    ctx.fillStyle = ink;
    ctx.font = "12px sans-serif";
    ctx.fillText("CHORDS", left + 12, railY + 29);
  }
  ctx.save();
  if (clipLeft !== undefined) {
    ctx.beginPath();
    ctx.rect(clipLeft, railY, Math.max(0, last.x + last.width - clipLeft), LANE_HEIGHT);
    ctx.clip();
  }
  paintMeasures(ctx, args);
  for (const { chord, point, width } of positionTrackChords(system, chords)) {
    const unsupported = resolveChordSymbol(chord.symbol).status === "unsupported";
    ctx.globalAlpha =
      dragPreview &&
      chord.measureIndex === dragPreview.source.measureIndex &&
      chord.symbol === dragPreview.source.symbol
        ? 0.3
        : 1;
    ctx.font = canvasTextFont("serif", 22);
    paintCommand(ctx, {
      type: "DrawText",
      x: point.x,
      y: railY + 39,
      text: fitChordLabel(ctx, formatChordSymbolText(chord.symbol), width),
      font: "serif",
      size: 22,
      color: unsupported ? "#b33d43" : ink,
      align: "left",
      baseline: "alphabetic",
    });
    if (unsupported) {
      ctx.fillStyle = "#b33d43";
      ctx.font = "10px sans-serif";
      ctx.fillText("!", point.x - 8, railY + 36);
    }
    ctx.globalAlpha = 1;
  }
  if (active) {
    ctx.fillStyle = "rgba(33, 150, 243, 0.7)";
    ctx.fillRect(active.x, railY + 18, 1, 32);
    if (!pointChord(chords, active)) {
      ctx.font = "20px sans-serif";
      ctx.fillText("+", active.x + 6, railY + 37);
    }
  }
  if (playheadX !== undefined) {
    ctx.fillStyle = "rgba(33, 150, 243, 0.7)";
    ctx.fillRect(playheadX, railY, 2, LANE_HEIGHT);
  }
  if (dragPreview?.target) {
    const x = dragPreview.target.x;
    ctx.font = canvasTextFont("serif", 22);
    const text = formatChordSymbolText(dragPreview.source.symbol);
    const width = ctx.measureText(text).width + 10;
    ctx.fillStyle = background;
    ctx.fillRect(x - 4, railY + 17, width, 29);
    ctx.strokeStyle = dragPreview.valid ? "#2196f3" : "#b33d43";
    ctx.strokeRect(x - 4, railY + 17, width, 29);
    paintCommand(ctx, {
      type: "DrawText",
      x,
      y: railY + 39,
      text,
      font: "serif",
      size: 22,
      color: dragPreview.valid ? ink : "#b33d43",
      align: "left",
      baseline: "alphabetic",
    });
  }
  ctx.restore();
}

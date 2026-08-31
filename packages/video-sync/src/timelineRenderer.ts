/**
 * Painting the timeline.
 *
 * Laid out top to bottom as filmstrip, picture ruler, waveform, bar ruler — the
 * order a composer reads it in, with picture above and music below so the
 * stretching of one against the other is visible at a glance.
 *
 * The renderer is deliberately dumb: it receives a fully resolved scene and
 * draws it. All timing conversion happens upstream through the tempo model, so
 * there is no second source of truth about where a bar falls.
 */

import { chooseTickInterval, endSeconds, ticksFor, xForSeconds } from "./timelineGeometry";
import { formatShortClockTime } from "./timecode";
import type { TimelineBar, TimelineScene } from "./timelineTypes";
import { peaksForRange } from "./waveformPeaks";

/** Vertical bands, as fractions of the canvas height. */
const LANES = {
  filmstrip: { top: 0, height: 0.24 },
  pictureRuler: { top: 0.24, height: 0.12 },
  waveform: { top: 0.36, height: 0.2 },
  barRuler: { top: 0.62, height: 0.38 },
} as const;

/**
 * Lane heights, for callers that must size something to a lane.
 *
 * The filmstrip decoder needs this: a thumbnail decoded at anything other than
 * the lane's device-pixel height gets rescaled on every blit and reads soft.
 */
export const LANE_FRACTIONS = {
  filmstrip: LANES.filmstrip.height,
} as const;

export interface TimelinePalette {
  /** Used to shade regions outside the clip, translucently. */
  readonly surface: string;
  readonly grid: string;
  readonly text: string;
  readonly textMuted: string;
  readonly bar: string;
  readonly barAlt: string;
  readonly hit: string;
  readonly hitUnlocked: string;
  readonly playhead: string;
  readonly waveform: string;
  readonly selection: string;
}

/** Read theme colours once per frame so the canvas follows light/dark. */
export function paletteFrom(element: HTMLElement): TimelinePalette {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    surface: read("--bg", "#141416"),
    grid: read("--border", "#3a3a3d"),
    text: read("--text", "#e8e8ea"),
    textMuted: read("--text-muted", "#9a9aa0"),
    bar: read("--accent", "#4a9eff"),
    barAlt: read("--border", "#3a3a3d"),
    hit: read("--danger", "#ff5f56"),
    hitUnlocked: read("--text-muted", "#9a9aa0"),
    playhead: read("--accent", "#4a9eff"),
    waveform: read("--picture-waveform", "#4f73a6"),
    selection: read("--picture-region", "#8061a8"),
  };
}

export function drawTimeline(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  const { widthPx: w, heightPx: h, devicePixelRatio: dpr } = scene;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Cleared, not filled. The workspace paints a mesh gradient behind every
  // activity and sets `--canvas-bg: transparent` so canvases show it through;
  // filling an opaque card colour here is what made this activity look like a
  // widget sitting on the workspace rather than part of it.
  ctx.clearRect(0, 0, w, h);

  drawBeyondClip(ctx, scene, palette);
  drawSelectedSpan(ctx, scene, palette);
  drawThumbnails(ctx, scene);
  drawPictureRuler(ctx, scene, palette);
  drawWaveform(ctx, scene, palette);
  drawBars(ctx, scene, palette);
  drawHits(ctx, scene, palette);
  drawPlayhead(ctx, scene, palette);

  ctx.restore();
}

function lane(scene: TimelineScene, key: keyof typeof LANES): { top: number; height: number } {
  const spec = LANES[key];
  return { top: spec.top * scene.heightPx, height: spec.height * scene.heightPx };
}

/**
 * Shade anything before the first frame or after the last.
 *
 * A scrim rather than an opaque fill, so the workspace's own background still
 * reads through and the shaded region looks like part of the same surface
 * rather than a panel laid over it.
 */
function drawBeyondClip(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  const startX = xForSeconds(0, scene.viewport);
  const endX = xForSeconds(scene.durationSeconds, scene.viewport);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = palette.surface;
  if (startX > 0) ctx.fillRect(0, 0, Math.min(startX, scene.widthPx), scene.heightPx);
  if (endX < scene.widthPx) ctx.fillRect(Math.max(0, endX), 0, scene.widthPx - Math.max(0, endX), scene.heightPx);
  ctx.restore();
}

function drawSelectedSpan(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  if (!scene.selectedSpan) return;
  const from = xForSeconds(scene.selectedSpan.fromSeconds, scene.viewport);
  const to = xForSeconds(scene.selectedSpan.toSeconds, scene.viewport);
  ctx.save();
  ctx.fillStyle = palette.selection;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(from, 0, to - from, scene.heightPx);
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = palette.selection;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(from) + 0.5, 0);
  ctx.lineTo(Math.round(from) + 0.5, scene.heightPx);
  ctx.moveTo(Math.round(to) + 0.5, 0);
  ctx.lineTo(Math.round(to) + 0.5, scene.heightPx);
  ctx.stroke();
  ctx.restore();
}

/**
 * The filmstrip.
 *
 * Tiles arrive already sized and positioned (see `useFilmstrip`), so this only
 * blits them. Each is drawn at its own width starting from its own time, which
 * is what makes the strip contiguous: the grid pitch *is* the tile width.
 *
 * A tile whose bitmap has been detached is skipped rather than drawn. The
 * filmstrip is a navigation aid; it must not be able to take the bars, the
 * waveform and the playhead down with it, which is what happened when
 * `drawImage` threw on a closed bitmap and aborted the whole paint.
 */
function drawThumbnails(ctx: CanvasRenderingContext2D, scene: TimelineScene): void {
  const { top, height } = lane(scene, "filmstrip");
  if (!scene.thumbnails?.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, scene.widthPx, height);
  ctx.clip();
  for (const thumb of scene.thumbnails) {
    if (!isDrawable(thumb.image)) continue;
    const x = xForSeconds(thumb.pictureSeconds, scene.viewport);
    if (x + thumb.widthPx < 0 || x > scene.widthPx) continue;
    // Rounded outward by a pixel so neighbouring tiles cannot leave a seam of
    // background between them after sub-pixel positioning.
    ctx.drawImage(thumb.image, Math.floor(x), top, Math.ceil(thumb.widthPx) + 1, height);
  }
  ctx.restore();
}

/**
 * Whether an image source can be blitted at all.
 *
 * Closing an `ImageBitmap` zeroes its dimensions, and that is the only tell it
 * leaves; a zero-sized source is what `drawImage` rejects. Checking the size
 * rather than the detached flag also covers a canvas that has not been sized
 * yet, and needs no `instanceof` against a global that not every runtime has.
 */
export function isDrawable(image: CanvasImageSource): boolean {
  const width = (image as { width?: unknown }).width;
  return typeof width !== "number" || width > 0;
}

function drawPictureRuler(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  const { top, height } = lane(scene, "pictureRuler");
  const interval = chooseTickInterval(scene.viewport.secondsPerPixel);
  const ticks = ticksFor(scene.viewport, scene.widthPx, interval);

  ctx.save();
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (const seconds of ticks) {
    if (seconds < 0) continue;
    const x = Math.round(xForSeconds(seconds, scene.viewport)) + 0.5;
    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();
    ctx.fillStyle = palette.textMuted;
    ctx.fillText(formatShortClockTime(seconds), x + 4, top + height / 2);
  }
  ctx.restore();
}

function drawWaveform(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  const wave = scene.waveform;
  if (!wave) return;
  const { top, height } = lane(scene, "waveform");
  const mid = top + height / 2;
  const half = height / 2 - 1;

  const columns = waveformColumns(wave, scene);

  ctx.save();
  ctx.strokeStyle = palette.waveform;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (let x = 0; x < scene.widthPx; x++) {
    const lo = columns[x * 2]!;
    const hi = columns[x * 2 + 1]!;
    if (lo === 0 && hi === 0) continue;
    ctx.moveTo(x + 0.5, mid - hi * half);
    ctx.lineTo(x + 0.5, mid - lo * half);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The reduced envelope for the current viewport, cached across paints.
 *
 * Reducing across the whole column is what keeps isolated transients visible
 * when zoomed out (sampling one bucket per column drops them), but it is a loop
 * over every bucket in view and the timeline repaints on every playhead tick.
 * The result only depends on the window, so one entry is enough: the playhead
 * moving does not change it.
 */
let waveformCache: { key: string; columns: Float32Array } | null = null;

function waveformColumns(wave: NonNullable<TimelineScene["waveform"]>, scene: TimelineScene): Float32Array {
  const from = scene.viewport.startSeconds;
  const to = endSeconds(scene.viewport, scene.widthPx);
  const key = `${wave.secondsPerBucket}:${wave.peaks.length}:${from}:${to}:${scene.widthPx}`;
  if (waveformCache?.key === key) return waveformCache.columns;
  const columns = peaksForRange(wave, from, to, scene.widthPx);
  waveformCache = { key, columns };
  return columns;
}

/**
 * The elastic ruler.
 *
 * Bar lines are drawn from picture time, so as the tempo map changes they visibly
 * compress and stretch against the fixed ruler above. Numbering thins out as
 * bars get narrow rather than overprinting.
 */
function drawBars(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  const { top, height } = lane(scene, "barRuler");
  ctx.save();
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "top";

  const widthOf = (bar: TimelineBar) => (bar.endSeconds - bar.startSeconds) / scene.viewport.secondsPerPixel;
  const labelEvery = labelStride(scene.bars, widthOf);

  for (const bar of scene.bars) {
    const x = Math.round(xForSeconds(bar.startSeconds, scene.viewport)) + 0.5;
    if (x < -80 || x > scene.widthPx + 80) continue;

    // A bar that starts a new meter or tempo gets a heavier line: those are the
    // structural moments a composer scans for.
    const structural = bar.meter !== undefined || bar.bpm !== undefined;
    ctx.strokeStyle = structural ? palette.bar : palette.barAlt;
    ctx.lineWidth = structural ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();

    if (bar.number % labelEvery === 0 || structural) {
      ctx.fillStyle = structural ? palette.text : palette.textMuted;
      ctx.fillText(String(bar.number), x + 3, top + 3);
    }
    if (bar.meter) {
      ctx.fillStyle = palette.text;
      ctx.fillText(`${bar.meter.count}/${bar.meter.unit}`, x + 3, top + 15);
    }
    if (bar.bpm !== undefined) {
      ctx.fillStyle = palette.textMuted;
      ctx.fillText(`♩=${bar.bpm}`, x + 3, top + 27);
    }
  }
  ctx.restore();
}

/** Label every Nth bar so numbers never collide at low zoom. */
function labelStride(bars: readonly TimelineBar[], widthOf: (bar: TimelineBar) => number): number {
  if (bars.length === 0) return 1;
  const typical = widthOf(bars[Math.floor(bars.length / 2)]!);
  if (typical > 46) return 1;
  if (typical > 22) return 2;
  if (typical > 10) return 5;
  return 10;
}

function drawHits(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  ctx.save();
  ctx.font = "10px system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (const hit of scene.hits) {
    const x = Math.round(xForSeconds(hit.pictureSeconds, scene.viewport)) + 0.5;
    if (x < -60 || x > scene.widthPx + 60) continue;
    const selected = hit.id === scene.selectedHitId;

    ctx.strokeStyle = hit.locked ? palette.hit : palette.hitUnlocked;
    ctx.lineWidth = selected ? 2 : 1;
    // An unlocked hit is a note-to-self the solver may ignore, so it is dashed.
    ctx.setLineDash(hit.locked ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, scene.heightPx);
    ctx.stroke();
    ctx.setLineDash([]);

    // Downward triangle marks the exact frame.
    ctx.fillStyle = hit.locked ? palette.hit : palette.hitUnlocked;
    ctx.beginPath();
    ctx.moveTo(x - 4, 0);
    ctx.lineTo(x + 4, 0);
    ctx.lineTo(x, 7);
    ctx.closePath();
    ctx.fill();

    if (hit.label && (selected || scene.viewport.secondsPerPixel < 0.2)) {
      ctx.fillStyle = palette.text;
      ctx.fillText(hit.label, x + 6, 8);
    }
  }
  ctx.restore();
}

function drawPlayhead(ctx: CanvasRenderingContext2D, scene: TimelineScene, palette: TimelinePalette): void {
  if (scene.playheadSeconds === null) return;
  const x = Math.round(xForSeconds(scene.playheadSeconds, scene.viewport)) + 0.5;
  ctx.save();
  ctx.strokeStyle = palette.playhead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, scene.heightPx);
  ctx.stroke();
  ctx.restore();
}

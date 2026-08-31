/**
 * Mapping the cue onto the timeline canvas.
 *
 * Pure geometry, kept apart from rendering so it can be tested without a canvas
 * and reused by hit-testing. Everything is expressed in *picture seconds*
 * because that is the axis the composer is working against; score positions are
 * converted in via the tempo model rather than tracked separately.
 *
 * The viewport is a window onto picture time (`startSeconds`, `secondsPerPixel`)
 * rather than a zoom factor, so panning and zooming are the same operation and
 * neither accumulates error.
 */

import type { TimelineViewport } from "./timelineTypes";

/** Pixel column for a picture time. */
export function xForSeconds(seconds: number, viewport: TimelineViewport): number {
  return (seconds - viewport.startSeconds) / viewport.secondsPerPixel;
}

/** Whether the browser reports a scaled display; 1 where there is no window. */
export function devicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

/** Picture time under a pixel column. */
export function secondsForX(x: number, viewport: TimelineViewport): number {
  return viewport.startSeconds + x * viewport.secondsPerPixel;
}

/** Last picture time visible at the given width. */
export function endSeconds(viewport: TimelineViewport, widthPx: number): number {
  return secondsForX(widthPx, viewport);
}

/** Whether a picture time falls inside the visible window. */
export function isVisible(seconds: number, viewport: TimelineViewport, widthPx: number): boolean {
  const x = xForSeconds(seconds, viewport);
  return x >= 0 && x <= widthPx;
}

/**
 * Fit a duration to the available width.
 *
 * Used on attach and on "fit" so the whole cue is visible without the composer
 * having to find it.
 */
export function fitViewport(durationSeconds: number, widthPx: number, safeAreaLeftPx = 0): TimelineViewport {
  const safeLeft = normalizeSafeAreaLeft(safeAreaLeftPx, widthPx);
  const usable = Math.max(1, widthPx - safeLeft);
  const span = Math.max(durationSeconds, 1);
  const secondsPerPixel = span / usable;
  return {
    // The canvas is full bleed. Negative picture time fills the area behind the
    // floating panel so media time zero begins at the safe edge.
    startSeconds: safeLeft === 0 ? 0 : -safeLeft * secondsPerPixel,
    secondsPerPixel,
  };
}

/**
 * Zoom about a fixed pixel column.
 *
 * Anchoring on the cursor rather than the viewport's left edge is what makes
 * wheel-zoom feel attached to the picture: the frame under the pointer stays
 * put while everything else scales around it.
 */
export function zoomAt(viewport: TimelineViewport, x: number, factor: number, limits: ZoomLimits): TimelineViewport {
  const anchor = secondsForX(x, viewport);
  const next = clamp(viewport.secondsPerPixel * factor, limits.minSecondsPerPixel, limits.maxSecondsPerPixel);
  return { startSeconds: anchor - x * next, secondsPerPixel: next };
}

/** Keep the same picture time at the safe edge when a floating panel resizes. */
export function shiftViewportSafeArea(
  viewport: TimelineViewport,
  previousSafeAreaLeftPx: number,
  nextSafeAreaLeftPx: number,
): TimelineViewport {
  return {
    ...viewport,
    startSeconds: viewport.startSeconds - (nextSafeAreaLeftPx - previousSafeAreaLeftPx) * viewport.secondsPerPixel,
  };
}

/** Bounds on how far the timeline can be zoomed. */
export interface ZoomLimits {
  /** Most zoomed in. Below roughly a frame per pixel there is nothing more to see. */
  readonly minSecondsPerPixel: number;
  /** Most zoomed out. */
  readonly maxSecondsPerPixel: number;
}

/** Zoom bounds for a clip: from a quarter-frame per pixel out to the whole cue. */
export function zoomLimitsFor(
  durationSeconds: number,
  widthPx: number,
  frameRate: number,
  safeAreaLeftPx = 0,
): ZoomLimits {
  const safeWidth = Math.max(1, widthPx - normalizeSafeAreaLeft(safeAreaLeftPx, widthPx));
  return {
    minSecondsPerPixel: 1 / frameRate / 4,
    maxSecondsPerPixel: Math.max(durationSeconds, 1) / safeWidth,
  };
}

/** Keep the window within the clip, allowing a little slack at each end. */
export function clampViewport(
  viewport: TimelineViewport,
  durationSeconds: number,
  widthPx: number,
  safeAreaLeftPx = 0,
): TimelineViewport {
  const safeLeft = normalizeSafeAreaLeft(safeAreaLeftPx, widthPx);
  const safeVisible = (widthPx - safeLeft) * viewport.secondsPerPixel;
  const slack = safeVisible * 0.1;
  const safeStart = -safeLeft * viewport.secondsPerPixel;
  const minStart = safeStart - slack;
  const maxStart = Math.max(safeStart, durationSeconds - widthPx * viewport.secondsPerPixel) + slack;
  return {
    ...viewport,
    startSeconds: clamp(viewport.startSeconds, minStart, maxStart),
  };
}

/**
 * Choose a tick interval that keeps labels legible at the current zoom.
 *
 * Steps are the ones a person reading a clock expects — 1, 2, 5, 10, 15, 30
 * seconds, then whole minutes — rather than a plain power-of-ten ladder, which
 * would produce intervals like 20s that are awkward to read against timecode.
 */
const TICK_STEPS = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600] as const;

export function chooseTickInterval(secondsPerPixel: number, minPixelGap = 70): number {
  const wanted = secondsPerPixel * minPixelGap;
  return TICK_STEPS.find((step) => step >= wanted) ?? TICK_STEPS[TICK_STEPS.length - 1]!;
}

/** Tick times covering the visible window, aligned to whole multiples. */
export function ticksFor(viewport: TimelineViewport, widthPx: number, interval: number): number[] {
  const from = secondsForX(0, viewport);
  const to = secondsForX(widthPx, viewport);
  const first = Math.floor(from / interval) * interval;
  const ticks: number[] = [];
  // Guard against a degenerate interval producing an unbounded loop.
  for (let t = first; t <= to && ticks.length < 2000; t += interval) ticks.push(t);
  return ticks;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Clamp a floating-panel safe edge to the actual canvas width. */
export function normalizeSafeAreaLeft(safeAreaLeftPx: number, widthPx: number): number {
  if (!Number.isFinite(safeAreaLeftPx) || widthPx <= 1) return 0;
  return clamp(safeAreaLeftPx, 0, widthPx - 1);
}

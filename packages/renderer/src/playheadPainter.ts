/**
 * Playhead Painter — renders a vertical playhead cursor line during playback.
 *
 * Maps a beat position to an X coordinate using the layout engine's
 * MeasureBounds.beatAnchors, then draws a semi-transparent vertical line
 * spanning all staves in the current system.
 *
 * standard engraving practice draws a similar blue playhead line spanning
 * all staves in the system during playback (ScoreView::setPlayPos).
 */

import type { MeasureBounds, DisplayList } from "./wasm";
import type { StaffInfo } from "./overlayPainter";

/** A playhead position expressed as a measure index and beat within that measure. */
export interface PlayheadPosition {
  /** 0-based measure index. */
  measureIndex: number;
  /** Beat position within the measure (0 = start of measure). */
  beat: number;
}

/**
 * Where the playhead was drawn, in the painter's coordinate space. Returned by
 * `paintPlayheadAtPosition` so callers can drive auto-scroll: `x` positions the
 * view horizontally, and the `yTop`/`yBottom` band lets a tall system be
 * scrolled fully into view vertically.
 */
export interface PlayheadDraw {
  x: number;
  yTop: number;
  yBottom: number;
}

/** Default playhead color: semi-transparent blue, matching standard practice. */
const PLAYHEAD_COLOR = "rgba(33, 150, 243, 0.6)";
/** Default playhead line width in score-space pixels. */
const PLAYHEAD_WIDTH = 2;

/**
 * Map a (measureIndex, beat) position to an X coordinate in score space
 * using the layout engine's beat anchors from MeasureBounds.
 *
 * Uses linear interpolation between adjacent beat anchors.
 * Returns null if the measure or beat position cannot be resolved.
 *
 * Barline smoothing: a measure's final beat anchor is the synthetic
 * `(totalBeats, rightEdge)` pair, but the next measure's beat 0 sits a
 * `prefixWidth` further right (trailing pad + barline + next prefix). Left
 * as-is, the playhead snaps across that dead zone the instant `beat` resets
 * at the boundary. When the next measure is on the same system we instead map
 * `totalBeats` to the next measure's first-content X, so the cursor glides
 * continuously across the barline over the final note's duration.
 */
export function beatToX(position: PlayheadPosition, measureBounds: MeasureBounds[]): number | null {
  // Find the bounds for this measure (any part index — they share X positions)
  const bounds =
    measureBounds.find((b) => b.index === position.measureIndex && b.partIndex === 0) ??
    measureBounds.find((b) => b.index === position.measureIndex);
  if (!bounds) return null;
  const endX = nextMeasureContinuityX(bounds, position.measureIndex, measureBounds);
  return interpolateBeatAnchors(bounds, position.beat, endX);
}

/**
 * The X the playhead should reach at this measure's end (`totalBeats`) so the
 * barline crossing is continuous — the next measure's first-content X, or
 * `undefined` when smoothing shouldn't apply (no next measure, or it starts a
 * new system / page so the cursor must reach this line's right edge first).
 */
function nextMeasureContinuityX(
  bounds: MeasureBounds,
  measureIndex: number,
  measureBounds: MeasureBounds[],
): number | undefined {
  const next =
    measureBounds.find((b) => b.index === measureIndex + 1 && b.partIndex === 0) ??
    measureBounds.find((b) => b.index === measureIndex + 1);
  if (!next) return undefined;

  // Only smooth across the barline within a system. Across a system/page break
  // the next measure is on another line, so the playhead should still finish at
  // this measure's right edge and then jump to the next line's start.
  if (bounds.systemIndex !== undefined && next.systemIndex !== undefined && next.systemIndex !== bounds.systemIndex) {
    return undefined;
  }

  // First-content X of the next measure: its beat-0 anchor, else its prefix end.
  const nextStart =
    next.beatAnchors && next.beatAnchors.length > 0 ? next.beatAnchors[0]![1] : next.x + next.prefixWidth;

  // Guard: only ever smooth forward (the next measure should be to the right).
  return nextStart > bounds.x + bounds.width ? nextStart : undefined;
}

/**
 * Interpolate beat position to X coordinate using a measure's beat anchors.
 *
 * `endX`, when provided, overrides the X of the final anchor *only when that
 * anchor is the synthetic measure-end anchor* (its beat ≈ `totalBeats`). This
 * is how barline smoothing maps a measure's end to the next measure's start
 * without disturbing real note anchors.
 */
function interpolateBeatAnchors(bounds: MeasureBounds, beat: number, endX?: number): number | null {
  const anchors = bounds.beatAnchors;
  if (!anchors || anchors.length === 0) {
    // No anchors — use linear interpolation across measure width
    if (bounds.totalBeats <= 0) return bounds.x + bounds.prefixWidth;
    const contentWidth = bounds.width - bounds.prefixWidth;
    const fraction = beat / bounds.totalBeats;
    return bounds.x + bounds.prefixWidth + fraction * contentWidth;
  }

  // Clamp beat to valid range
  const clampedBeat = Math.max(0, beat);

  // Effective X of the final anchor. The layout always appends a synthetic
  // (totalBeats, rightEdge) anchor; when `endX` is supplied and the last anchor
  // is that synthetic end (beat ≈ totalBeats), use it so the barline crossing
  // is continuous. Real note anchors are never overridden.
  const lastIdx = anchors.length - 1;
  const lastIsMeasureEnd = Math.abs(anchors[lastIdx]![0] - bounds.totalBeats) < 1e-6;
  const lastX = endX !== undefined && lastIsMeasureEnd ? endX : anchors[lastIdx]![1];
  const xAt = (i: number): number => (i === lastIdx ? lastX : anchors[i]![1]);

  // Before first anchor: extrapolate left
  const first = anchors[0]!;
  if (clampedBeat <= first[0]) {
    if (anchors.length === 1) return xAt(0);
    const second = anchors[1]!;
    const pxPerBeat = second[0] !== first[0] ? (xAt(1) - first[1]) / (second[0] - first[0]) : 0;
    return first[1] + (clampedBeat - first[0]) * pxPerBeat;
  }

  // After last anchor: extrapolate right
  const last = anchors[lastIdx]!;
  if (clampedBeat >= last[0]) {
    if (anchors.length === 1) return lastX;
    const prev = anchors[lastIdx - 1]!;
    const pxPerBeat = last[0] !== prev[0] ? (lastX - xAt(lastIdx - 1)) / (last[0] - prev[0]) : 0;
    return lastX + (clampedBeat - last[0]) * pxPerBeat;
  }

  // Between anchors: linear interpolation
  for (let i = 0; i < lastIdx; i++) {
    const lo = anchors[i]!;
    const hi = anchors[i + 1]!;
    if (clampedBeat >= lo[0] && clampedBeat <= hi[0]) {
      const range = hi[0] - lo[0];
      if (range === 0) return xAt(i);
      const t = (clampedBeat - lo[0]) / range;
      return xAt(i) + t * (xAt(i + 1) - xAt(i));
    }
  }

  return lastX;
}

/**
 * Find the Y extent (top and bottom) of all staves that contain a given X
 * position. Groups staves into the "system" at that X coordinate.
 *
 * Returns null if no staves are found at the given X.
 *
 * `pageYRange` defines the vertical bounds of the page that contains the
 * cursor's measure. The upper bound (`yEnd`) should be the *next* page's
 * `yOffset` (or `+Infinity` for the last page) rather than `yOffset + height`,
 * so that systems which overflow the fixed page height are still attributed to
 * the page that contains their first stave.
 */
export function findSystemYExtent(
  staves: StaffInfo[],
  x: number,
  pageYRange?: { yOffset: number; yEnd: number },
  systemYRange?: { yTop: number; yBottom: number },
): { yTop: number; yBottom: number } | null {
  // Collect staves that span this X position (with margin)
  let matching = staves.filter((s) => x >= s.x - s.spatium && x <= s.xEnd + s.spatium);

  // Restrict to the system's vertical band so only staves belonging to the
  // cursor's system are included — otherwise, in a part view with one staff
  // per system, every system below/above the cursor matches the X filter and
  // the playhead stretches the full page.
  //
  // `systemYRange` is derived from the cursor system's `systemIndex`, which is
  // globally unique, so it isolates the system precisely AND is immune to page
  // overflow. When it is available it fully supersedes the page-based filter
  // below: a tall orchestral system can extend past the next page's `yOffset`,
  // and applying `pageYRange` first would wrongly prune the overflowing lower
  // staves (Trombones → Piano) before this band could include them.
  if (systemYRange) {
    // Allow a small tolerance (half a spatium) on either side so staves
    // whose Y line up with the band's edge are not excluded by fp jitter.
    const tol = (matching[0]?.spatium ?? 0) * 0.5;
    matching = matching.filter((s) => s.y + s.height >= systemYRange.yTop - tol && s.y <= systemYRange.yBottom + tol);
  } else if (pageYRange) {
    // Fallback when no system band is known: filter to staves on the cursor's
    // page only. Without this, staves on different pages that share the same X
    // range would all match, causing the playhead to span the entire score.
    matching = matching.filter((s) => s.y >= pageYRange.yOffset && s.y < pageYRange.yEnd);
  }

  if (matching.length === 0) return null;

  const margin = matching[0]!.spatium * 0.5;
  const yTop = Math.min(...matching.map((s) => s.y)) - margin;
  const yBottom = Math.max(...matching.map((s) => s.y + s.height)) + margin;

  return { yTop, yBottom };
}

/**
 * Paint a playhead cursor line on a canvas context.
 * Coordinates are in score space — the caller must apply viewport transform first.
 *
 * @param ctx Canvas 2D context with viewport transform already applied
 * @param x X coordinate in score space
 * @param yTop Top Y of the line in score space
 * @param yBottom Bottom Y of the line in score space
 * @param color Optional override color (default: semi-transparent blue)
 * @param lineWidth Optional override width (default: 2px)
 */
export function paintPlayhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  yBottom: number,
  color: string = PLAYHEAD_COLOR,
  lineWidth: number = PLAYHEAD_WIDTH,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x, yBottom);
  ctx.stroke();
  ctx.restore();
}

/**
 * High-level function: given a playhead position, display list, and detected
 * staves, paint the playhead cursor on the canvas.
 *
 * Returns the X coordinate of the playhead (for auto-scroll), or null if
 * the position could not be resolved.
 */
/**
 * Find which page (if any) contains a given Y coordinate.
 */
export function findPageForY(
  pages: Array<{ yOffset: number; height: number }>,
  y: number,
): { yOffset: number; height: number; index: number } | null {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    if (y >= p.yOffset && y < p.yOffset + p.height) {
      return { yOffset: p.yOffset, height: p.height, index: i };
    }
  }
  return null;
}

export function paintPlayheadAtPosition(
  ctx: CanvasRenderingContext2D,
  position: PlayheadPosition,
  displayList: DisplayList,
  staves: StaffInfo[],
  color?: string,
): PlayheadDraw | null {
  if (!displayList.measureBounds || displayList.measureBounds.length === 0) {
    return null;
  }

  const x = beatToX(position, displayList.measureBounds);
  if (x === null) return null;

  // Determine the page for this measure so we only match staves on that page.
  // Use the *next* page's yOffset (or +Infinity) as the upper bound rather
  // than the current page's height, so that systems which overflow the fixed
  // page height still attribute their lower staves to the correct page.
  const pages = displayList.pages;
  let pageYRange: { yOffset: number; yEnd: number } | undefined;
  const cursorBounds =
    displayList.measureBounds.find((b) => b.index === position.measureIndex && b.partIndex === 0) ??
    displayList.measureBounds.find((b) => b.index === position.measureIndex);
  if (pages && pages.length > 0 && cursorBounds) {
    const page = findPageForY(pages, cursorBounds.y);
    if (page) {
      const next = pages[page.index + 1];
      pageYRange = {
        yOffset: page.yOffset,
        yEnd: next ? next.yOffset : Number.POSITIVE_INFINITY,
      };
    }
  }

  // Further restrict to the system that contains the cursor's measure.
  // Without this, every system in a single-instrument part view matches the
  // X filter (same column across systems) and the playhead spans the whole
  // page. We narrow to staves whose Y lies within the system's vertical band,
  // computed from all measure bounds sharing the cursor's `systemIndex`.
  let systemYRange: { yTop: number; yBottom: number } | undefined;
  if (cursorBounds && cursorBounds.systemIndex !== undefined) {
    const sysIdx = cursorBounds.systemIndex;
    let yTop = Number.POSITIVE_INFINITY;
    let yBottom = Number.NEGATIVE_INFINITY;
    for (const b of displayList.measureBounds) {
      if (b.systemIndex === sysIdx) {
        if (b.y < yTop) yTop = b.y;
        if (b.y + b.height > yBottom) yBottom = b.y + b.height;
      }
    }
    if (Number.isFinite(yTop) && Number.isFinite(yBottom)) {
      systemYRange = { yTop, yBottom };
    }
  }

  const extent = findSystemYExtent(staves, x, pageYRange, systemYRange);
  if (extent) {
    paintPlayhead(ctx, x, extent.yTop, extent.yBottom, color);
    return { x, yTop: extent.yTop, yBottom: extent.yBottom };
  }
  // Fallback: draw across entire display list height
  paintPlayhead(ctx, x, 0, displayList.height, color);
  return { x, yTop: 0, yBottom: displayList.height };
}

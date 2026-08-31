/**
 * Viewport utilities for scroll and zoom.
 */

import { LIFE_SIZE_ZOOM } from "./zoomScale";

// Zoom range expressed as percentages of life-size (100% = LIFE_SIZE_ZOOM raw).
// Min 10% / max 1000% under default calibration.
export const MIN_ZOOM = 0.1 * LIFE_SIZE_ZOOM;
export const MAX_ZOOM = 10 * LIFE_SIZE_ZOOM;
export const ZOOM_STEP = 0.1;
export const SCROLL_SPEED = 1;

export interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/** Clamp zoom to allowed range. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Where to place content within the viewport when it fits entirely. */
export type ScrollAnchor = "center" | "start";

/** Per-axis scroll anchor (e.g. start horizontally, center vertically). */
export interface ScrollAnchorAxes {
  x: ScrollAnchor;
  y: ScrollAnchor;
}

/** Padding (in viewport CSS px) when anchoring content to the start edge. */
const START_ANCHOR_PAD_PX = 24;
/** Minimum screen-space edge visible when panning content beyond a viewport. */
const EDGE_VISIBLE_PX = 24;

/** Chrome that covers the scroll container along one axis, in viewport CSS px.
 *  `leading` is the left/top edge, `trailing` the right/bottom edge. Scroll
 *  bounds are computed against the region *between* these, so content can
 *  never be parked entirely behind floating panels or the status bar. */
export interface ScrollInsets {
  leading?: number;
  trailing?: number;
  /** Content-space coordinate of the first painted horizontal edge. */
  contentStart?: number;
  /** Fraction of content allowed to remain visible at the trailing cap. */
  edgeVisibleRatio?: number;
}

/** Clamp scroll so the viewport stays within reasonable bounds.
 *
 *  For overflowing content, the cap is the exact safe viewport boundary:
 *  the content's leading edge cannot pass the leading chrome, and its
 *  trailing edge cannot pass the trailing chrome. This intentionally avoids
 *  extra overscroll, because a page's blank margin can otherwise remain
 *  visible while all of its music is hidden behind a panel.
 *
 *  When content fits, the same bounds allow panning within the safe region
 *  without snapping to an anchor. */
export function clampScroll(
  scroll: number,
  contentSize: number,
  viewportSize: number,
  zoom: number,
  insets: ScrollInsets = {},
): number {
  const leading = Math.max(0, insets.leading ?? 0);
  const trailing = Math.max(0, insets.trailing ?? 0);
  // Degenerate chrome (insets wider than the container) would invert the
  // safe span; fall back to the full viewport in that case.
  const safeSpan = viewportSize - leading - trailing;
  const usable = safeSpan > 0 ? safeSpan : viewportSize;
  const safeLeading = safeSpan > 0 ? leading : 0;
  const safeTrailing = safeSpan > 0 ? trailing : 0;
  const contentStart = insets.contentStart ?? 0;

  // Content spans screen px [-scroll * zoom, (contentSize - scroll) * zoom].
  // When it overflows, keep its full nominal extent bounded by the safe
  // viewport edges. When it fits, use the corresponding range that keeps the
  // whole content inside the safe span while still allowing free panning.
  const scaledContent = contentSize * zoom;
  const edgeVisiblePx = Math.min(
    usable,
    Math.max(EDGE_VISIBLE_PX, scaledContent * Math.max(0, insets.edgeVisibleRatio ?? 0)),
  );
  const minScroll =
    scaledContent <= usable
      ? contentStart - (viewportSize - safeTrailing - edgeVisiblePx) / zoom + contentSize
      : contentStart - (viewportSize - safeTrailing - edgeVisiblePx) / zoom;
  const maxScroll =
    scaledContent <= usable ? contentStart - safeLeading / zoom : contentStart + contentSize - safeLeading / zoom;
  const clamped = Math.min(maxScroll, Math.max(minScroll, scroll));
  return clamped === 0 ? 0 : clamped;
}

/** Compute the "rest" scroll position for a given anchor — the natural
 *  initial position before the user has interacted. Used by useViewport
 *  for the initial useState value, not by per-event clamping. */
export function restScroll(
  contentSize: number,
  viewportSize: number,
  zoom: number,
  anchor: ScrollAnchor,
  startPad: number = START_ANCHOR_PAD_PX,
): number {
  const scaledContent = contentSize * zoom;
  if (scaledContent <= viewportSize) {
    if (anchor === "start") return -startPad / zoom;
    return -(viewportSize - scaledContent) / (2 * zoom);
  }
  // When content overflows, default rest depends on anchor:
  //   start → flush to top/left with pad
  //   center → top/left edge of content (0)
  if (anchor === "start") return -startPad / zoom;
  return 0;
}

/**
 * Compute new viewport after zooming centered on a point.
 * The point (in viewport pixel coordinates) stays fixed under zoom.
 */
export function zoomAtPoint(
  viewport: ViewportState,
  viewportX: number,
  viewportY: number,
  newZoom: number,
): ViewportState {
  const clamped = clampZoom(newZoom);
  // Convert viewport pixel to content coordinate before zoom
  const contentX = viewport.scrollX + viewportX / viewport.zoom;
  const contentY = viewport.scrollY + viewportY / viewport.zoom;
  // After zoom, the same content point should map to the same viewport pixel
  const newScrollX = contentX - viewportX / clamped;
  const newScrollY = contentY - viewportY / clamped;
  return { scrollX: newScrollX, scrollY: newScrollY, zoom: clamped };
}

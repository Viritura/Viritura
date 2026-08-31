import { useCallback, useRef, useState } from "react";
import {
  clampScroll as clampScrollRaw,
  zoomAtPoint,
  restScroll,
  type ViewportState,
  type ScrollAnchor,
  type ScrollAnchorAxes,
} from "../viewport";
import { getLifeSizeZoom } from "../zoomScale";
import { useViewportReclamp, useViewportWheel, useViewportPinch, useViewportMouseDrag } from "./useViewportEffects";

interface UseViewportOptions {
  contentWidth: number;
  contentHeight: number;
  /** Content-space origin of painted content on the horizontal axis. */
  contentStartX?: number;
  /** Initial zoom level (default: LIFE_SIZE_ZOOM, so the score renders at ~physical size). */
  initialZoom?: number;
  /** Where to anchor content within the viewport when it fits along an axis.
   *  Pass a single value to apply to both axes, or a per-axis object.
   *  Defaults to "center" on both axes. */
  scrollAnchor?: ScrollAnchor | ScrollAnchorAxes;
  /** Safe-area insets (in viewport CSS px) that floating UI panels occupy.
   *  When provided, the start-anchor padding uses these values so the
   *  default content position clears the panels. Has no effect on free
   *  panning — users can still scroll content under the panels. */
  safeArea?: { left?: number; top?: number; right?: number; bottom?: number };
  /**
   * Fired when a user gesture (wheel / drag / pinch) moves the viewport.
   * Used by follow-the-playhead to detach. Should be a stable reference.
   */
  onUserInteract?: () => void;
}

interface UseViewportResult {
  viewport: ViewportState;
  /** Attach to the scrollable container element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the user is currently dragging to pan. */
  isDragging: boolean;
  /** Reset zoom to initial (life-size) and scroll to origin. */
  resetViewport: () => void;
  /** Set zoom programmatically (centered on viewport center). */
  setZoom: (zoom: number) => void;
  /** Set scroll position programmatically (clamped to content bounds). */
  setScroll: (x: number, y: number) => void;
  /** Set to true to temporarily suppress pan drag (e.g. during spanner handle drag). */
  dragLockRef: React.MutableRefObject<boolean>;
}

/**
 * Manages viewport scroll and zoom state for a canvas-based renderer.
 *
 * Handles:
 * - Mouse wheel vertical scroll
 * - Shift+wheel horizontal scroll
 * - Ctrl+wheel zoom (centered on cursor)
 * - Mouse drag to pan
 * - Pinch-to-zoom on touch devices
 * - Scroll clamping to content bounds
 */
export function useViewport({
  contentWidth,
  contentHeight,
  contentStartX = 0,
  initialZoom = getLifeSizeZoom(),
  scrollAnchor = "center",
  safeArea,
  onUserInteract,
}: UseViewportOptions): UseViewportResult {
  const safeLeft = safeArea?.left ?? 0;
  const safeTop = safeArea?.top ?? 0;
  const safeRight = safeArea?.right ?? 0;
  const safeBottom = safeArea?.bottom ?? 0;
  const [viewport, setViewport] = useState<ViewportState>({
    scrollX: safeLeft > 0 ? -safeLeft / initialZoom : 0,
    scrollY: safeTop > 0 ? -safeTop / initialZoom : 0,
    zoom: initialZoom,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasUserPositionedViewportRef = useRef(false);

  // Bind clampScroll to the surrounding UI chrome so the scroll cap keeps
  // content inside the *unobstructed* region rather than behind panels.
  const anchorAxes: ScrollAnchorAxes =
    typeof scrollAnchor === "string" ? { x: scrollAnchor, y: scrollAnchor } : scrollAnchor;
  const startPadX = safeLeft > 0 ? safeLeft : undefined;
  const startPadY = safeTop > 0 ? safeTop : undefined;
  const clampScrollX = useCallback(
    (scroll: number, contentSize: number, viewportSize: number, zoom: number) =>
      clampScrollRaw(scroll, contentSize - contentStartX, viewportSize, zoom, {
        leading: safeLeft,
        trailing: safeRight,
        contentStart: contentStartX,
        edgeVisibleRatio: contentStartX > 0 ? 0.1 : undefined,
      }),
    [contentStartX, safeLeft, safeRight],
  );
  const clampScrollY = useCallback(
    (scroll: number, contentSize: number, viewportSize: number, zoom: number) =>
      clampScrollRaw(scroll, contentSize, viewportSize, zoom, { leading: safeTop, trailing: safeBottom }),
    [safeTop, safeBottom],
  );

  const restScrollX = useCallback(
    (viewportSize: number, zoom: number) => restScroll(contentWidth, viewportSize, zoom, anchorAxes.x, startPadX),
    [contentWidth, anchorAxes.x, startPadX],
  );
  const restScrollY = useCallback(
    (viewportSize: number, zoom: number) => restScroll(contentHeight, viewportSize, zoom, anchorAxes.y, startPadY),
    [contentHeight, anchorAxes.y, startPadY],
  );

  // Track drag/pan gesture state
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const dragLockRef = useRef(false);

  const effectDeps = {
    containerRef,
    contentWidth,
    contentHeight,
    clampScrollX,
    clampScrollY,
    setViewport,
    hasUserPositionedViewportRef,
    onUserInteract,
  };

  useViewportReclamp({ ...effectDeps, restScrollX, restScrollY });
  useViewportWheel(effectDeps);
  useViewportPinch(effectDeps);
  useViewportMouseDrag({ ...effectDeps, dragRef, dragLockRef, setIsDragging });

  const resetViewport = useCallback(() => {
    // Re-read calibration so reset picks up any newly-saved value.
    const zoom = initialZoom ?? getLifeSizeZoom();
    hasUserPositionedViewportRef.current = false;
    const el = containerRef.current;
    if (!el) {
      setViewport({
        scrollX: safeLeft > 0 ? -safeLeft / zoom : 0,
        scrollY: safeTop > 0 ? -safeTop / zoom : 0,
        zoom,
      });
      return;
    }
    setViewport({
      scrollX: clampScrollX(restScrollX(el.clientWidth, zoom), contentWidth, el.clientWidth, zoom),
      scrollY: clampScrollY(restScrollY(el.clientHeight, zoom), contentHeight, el.clientHeight, zoom),
      zoom,
    });
  }, [
    initialZoom,
    safeLeft,
    safeTop,
    clampScrollX,
    clampScrollY,
    restScrollX,
    restScrollY,
    contentWidth,
    contentHeight,
  ]);

  const setZoomCentered = useCallback(
    (newZoom: number) => {
      const el = containerRef.current;
      if (!el) return;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      setViewport((prev) => {
        const next = zoomAtPoint(prev, vw / 2, vh / 2, newZoom);
        return {
          scrollX: clampScrollX(next.scrollX, contentWidth, vw, next.zoom),
          scrollY: clampScrollY(next.scrollY, contentHeight, vh, next.zoom),
          zoom: next.zoom,
        };
      });
    },
    [contentWidth, contentHeight, clampScrollX, clampScrollY],
  );

  const setScroll = useCallback(
    (x: number, y: number) => {
      const el = containerRef.current;
      if (!el) return;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      setViewport((prev) => ({
        scrollX: clampScrollX(x, contentWidth, vw, prev.zoom),
        scrollY: clampScrollY(y, contentHeight, vh, prev.zoom),
        zoom: prev.zoom,
      }));
    },
    [contentWidth, contentHeight, clampScrollX, clampScrollY],
  );

  return {
    viewport,
    containerRef,
    isDragging,
    resetViewport,
    setZoom: setZoomCentered,
    setScroll,
    dragLockRef,
  };
}

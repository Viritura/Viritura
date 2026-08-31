/**
 * Side-effect hooks split out of useViewport.ts to keep the main hook small.
 *
 * Each hook wires DOM listeners (wheel / touch / mouse drag) and applies
 * scroll/zoom updates via the supplied setter, using clamp callbacks bound
 * to the active scroll-anchor policy.
 */

import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { clampZoom, zoomAtPoint, ZOOM_STEP, SCROLL_SPEED, type ViewportState } from "../viewport";

type ClampScroll = (scroll: number, contentSize: number, viewportSize: number, zoom: number) => number;
type SetVP = Dispatch<SetStateAction<ViewportState>>;

interface ViewportEffectDeps {
  containerRef: RefObject<HTMLDivElement | null>;
  contentWidth: number;
  contentHeight: number;
  clampScrollX: ClampScroll;
  clampScrollY: ClampScroll;
  setViewport: SetVP;
  hasUserPositionedViewportRef: MutableRefObject<boolean>;
  /**
   * Fired when a user gesture (wheel / drag / pinch) changes the viewport, so
   * features like follow-the-playhead can detach. Must be a stable reference —
   * it is captured once per effect setup and not in any dep array.
   */
  onUserInteract?: () => void;
}

interface ReclampDeps extends ViewportEffectDeps {
  restScrollX: (viewportSize: number, zoom: number) => number;
  restScrollY: (viewportSize: number, zoom: number) => number;
}

/**
 * Build a clamped ViewportState updater that re-clamps both axes using the
 * current container size — either preserving the user's scroll position or
 * snapping to the rest scroll if the user hasn't positioned yet.
 */
function makeReclampUpdater(el: HTMLElement, deps: ReclampDeps) {
  const {
    contentWidth,
    contentHeight,
    clampScrollX,
    clampScrollY,
    restScrollX,
    restScrollY,
    hasUserPositionedViewportRef,
  } = deps;
  return (prev: ViewportState): ViewportState => {
    const userPositioned = hasUserPositionedViewportRef.current;
    const baseX = userPositioned ? prev.scrollX : restScrollX(el.clientWidth, prev.zoom);
    const baseY = userPositioned ? prev.scrollY : restScrollY(el.clientHeight, prev.zoom);
    return {
      ...prev,
      scrollX: clampScrollX(baseX, contentWidth, el.clientWidth, prev.zoom),
      scrollY: clampScrollY(baseY, contentHeight, el.clientHeight, prev.zoom),
    };
  };
}

/** Re-clamp on content size changes and via ResizeObserver. */
export function useViewportReclamp(deps: ReclampDeps) {
  const {
    containerRef,
    contentWidth,
    contentHeight,
    clampScrollX,
    clampScrollY,
    restScrollX,
    restScrollY,
    setViewport,
  } = deps;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewport(makeReclampUpdater(el, deps));
    // deps object is recreated each render; we intentionally only depend on the
    // primitive inputs that actually affect the clamp.
  }, [contentWidth, contentHeight, clampScrollX, clampScrollY, restScrollX, restScrollY]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setViewport(makeReclampUpdater(el, deps));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentWidth, contentHeight, clampScrollX, clampScrollY, restScrollX, restScrollY]);
}

/** Wheel handler: ctrl/cmd → zoom, shift → horizontal, else vertical/trackpad. */
export function useViewportWheel(deps: ViewportEffectDeps) {
  const {
    containerRef,
    contentWidth,
    contentHeight,
    clampScrollX,
    clampScrollY,
    setViewport,
    hasUserPositionedViewportRef,
  } = deps;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      hasUserPositionedViewportRef.current = true;
      deps.onUserInteract?.();

      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const vx = e.clientX - rect.left;
        const vy = e.clientY - rect.top;
        const delta = -e.deltaY * ZOOM_STEP * 0.01;
        setViewport((prev) => {
          const newZoom = clampZoom(prev.zoom * (1 + delta));
          const next = zoomAtPoint(prev, vx, vy, newZoom);
          return {
            scrollX: clampScrollX(next.scrollX, contentWidth, el.clientWidth, next.zoom),
            scrollY: clampScrollY(next.scrollY, contentHeight, el.clientHeight, next.zoom),
            zoom: next.zoom,
          };
        });
        return;
      }

      if (e.shiftKey) {
        setViewport((prev) => ({
          ...prev,
          scrollX: clampScrollX(
            prev.scrollX + (e.deltaY * SCROLL_SPEED) / prev.zoom,
            contentWidth,
            el.clientWidth,
            prev.zoom,
          ),
        }));
        return;
      }

      setViewport((prev) => ({
        ...prev,
        scrollX:
          e.deltaX !== 0
            ? clampScrollX(
                prev.scrollX + (e.deltaX * SCROLL_SPEED) / prev.zoom,
                contentWidth,
                el.clientWidth,
                prev.zoom,
              )
            : prev.scrollX,
        scrollY: clampScrollY(
          prev.scrollY + (e.deltaY * SCROLL_SPEED) / prev.zoom,
          contentHeight,
          el.clientHeight,
          prev.zoom,
        ),
      }));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [contentWidth, contentHeight]);
}

function getTouchDistance(touches: TouchList): number {
  const t0 = touches.item(0)!;
  const t1 = touches.item(1)!;
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

function getTouchCenter(touches: TouchList, rect: DOMRect): { x: number; y: number } {
  const t0 = touches.item(0)!;
  const t1 = touches.item(1)!;
  return {
    x: (t0.clientX + t1.clientX) / 2 - rect.left,
    y: (t0.clientY + t1.clientY) / 2 - rect.top,
  };
}

/** Two-finger pinch-to-zoom on touch devices. */
export function useViewportPinch(deps: ViewportEffectDeps) {
  const {
    containerRef,
    contentWidth,
    contentHeight,
    clampScrollX,
    clampScrollY,
    setViewport,
    hasUserPositionedViewportRef,
  } = deps;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pinch: { distance: number; zoom: number } | null = null;
    let pinchState: { distance: number; zoom: number } | null = pinch;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        hasUserPositionedViewportRef.current = true;
        setViewport((prev) => {
          pinchState = { distance: getTouchDistance(e.touches), zoom: prev.zoom };
          return prev;
        });
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchState) {
        e.preventDefault();
        deps.onUserInteract?.();
        const newDist = getTouchDistance(e.touches);
        const scale = newDist / pinchState.distance;
        const newZoom = clampZoom(pinchState.zoom * scale);
        const rect = el.getBoundingClientRect();
        const center = getTouchCenter(e.touches, rect);
        setViewport((prev) => {
          const next = zoomAtPoint(prev, center.x, center.y, newZoom);
          return {
            scrollX: clampScrollX(next.scrollX, contentWidth, el.clientWidth, next.zoom),
            scrollY: clampScrollY(next.scrollY, contentHeight, el.clientHeight, next.zoom),
            zoom: next.zoom,
          };
        });
      }
    };

    const onTouchEnd = () => {
      pinchState = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [contentWidth, contentHeight]);
}

interface MouseDragDeps extends ViewportEffectDeps {
  dragRef: MutableRefObject<{ startX: number; startY: number } | null>;
  dragLockRef: MutableRefObject<boolean>;
  setIsDragging: Dispatch<SetStateAction<boolean>>;
}

/** Left/middle-click drag-to-pan with dragLock guard for spanner gestures. */
export function useViewportMouseDrag(deps: MouseDragDeps) {
  const {
    containerRef,
    contentWidth,
    contentHeight,
    clampScrollX,
    clampScrollY,
    setViewport,
    hasUserPositionedViewportRef,
    dragRef,
    dragLockRef,
    setIsDragging,
  } = deps;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startY: e.clientY };
        return;
      }
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;
      dragRef.current = { startX: e.clientX, startY: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      if (dragLockRef.current && e.buttons !== 4) {
        dragRef.current = null;
        setIsDragging(false);
        return;
      }
      setIsDragging(true);
      e.preventDefault();
      hasUserPositionedViewportRef.current = true;
      deps.onUserInteract?.();
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      dragRef.current = { startX: e.clientX, startY: e.clientY };
      setViewport((prev) => ({
        ...prev,
        scrollX: clampScrollX(prev.scrollX - dx / prev.zoom, contentWidth, el.clientWidth, prev.zoom),
        scrollY: clampScrollY(prev.scrollY - dy / prev.zoom, contentHeight, el.clientHeight, prev.zoom),
      }));
    };

    const onMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setIsDragging(false);
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [contentWidth, contentHeight]);
}

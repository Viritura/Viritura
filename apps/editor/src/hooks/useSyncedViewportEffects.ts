/**
 * Side-effect hooks for useSyncedViewport — wheel / pinch / mouse-drag wired
 * to two side-by-side containers that share a single ViewportState.
 */

import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { clampScroll, clampZoom, zoomAtPoint, ZOOM_STEP, SCROLL_SPEED, type ViewportState } from "../viewport";

type SetVP = Dispatch<SetStateAction<ViewportState>>;

interface SyncedDeps {
  leftRef: RefObject<HTMLDivElement | null>;
  rightRef: RefObject<HTMLDivElement | null>;
  contentWidth: number;
  contentHeight: number;
  getContainerSize: () => { clientWidth: number; clientHeight: number };
  setViewport: SetVP;
}

/** Re-clamp on content size changes and via ResizeObserver on both containers. */
export function useSyncedReclamp({
  leftRef,
  rightRef,
  contentWidth,
  contentHeight,
  getContainerSize,
  setViewport,
}: SyncedDeps) {
  useEffect(() => {
    const { clientWidth, clientHeight } = getContainerSize();
    setViewport((prev) => ({
      ...prev,
      scrollX: clampScroll(prev.scrollX, contentWidth, clientWidth, prev.zoom),
      scrollY: clampScroll(prev.scrollY, contentHeight, clientHeight, prev.zoom),
    }));
  }, [contentWidth, contentHeight, getContainerSize, setViewport]);

  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    if (!leftEl && !rightEl) return;
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = getContainerSize();
      setViewport((prev) => ({
        ...prev,
        scrollX: clampScroll(prev.scrollX, contentWidth, clientWidth, prev.zoom),
        scrollY: clampScroll(prev.scrollY, contentHeight, clientHeight, prev.zoom),
      }));
    });
    if (leftEl) observer.observe(leftEl);
    if (rightEl) observer.observe(rightEl);
    return () => observer.disconnect();
  }, [leftRef, rightRef, contentWidth, contentHeight, getContainerSize, setViewport]);
}

/** Wheel handler attached to both containers. */
export function useSyncedWheel({
  leftRef,
  rightRef,
  contentWidth,
  contentHeight,
  getContainerSize,
  setViewport,
}: SyncedDeps) {
  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;

      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const vx = e.clientX - rect.left;
        const vy = e.clientY - rect.top;
        const delta = -e.deltaY * ZOOM_STEP * 0.01;
        setViewport((prev) => {
          const { clientWidth, clientHeight } = getContainerSize();
          const newZoom = clampZoom(prev.zoom * (1 + delta));
          const next = zoomAtPoint(prev, vx, vy, newZoom);
          return {
            scrollX: clampScroll(next.scrollX, contentWidth, clientWidth, next.zoom),
            scrollY: clampScroll(next.scrollY, contentHeight, clientHeight, next.zoom),
            zoom: next.zoom,
          };
        });
        return;
      }

      if (e.shiftKey) {
        setViewport((prev) => {
          const { clientWidth } = getContainerSize();
          return {
            ...prev,
            scrollX: clampScroll(
              prev.scrollX + (e.deltaY * SCROLL_SPEED) / prev.zoom,
              contentWidth,
              clientWidth,
              prev.zoom,
            ),
          };
        });
        return;
      }

      setViewport((prev) => {
        const { clientHeight } = getContainerSize();
        return {
          ...prev,
          scrollY: clampScroll(
            prev.scrollY + (e.deltaY * SCROLL_SPEED) / prev.zoom,
            contentHeight,
            clientHeight,
            prev.zoom,
          ),
        };
      });
    };

    if (leftEl) leftEl.addEventListener("wheel", onWheel, { passive: false });
    if (rightEl) rightEl.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (leftEl) leftEl.removeEventListener("wheel", onWheel);
      if (rightEl) rightEl.removeEventListener("wheel", onWheel);
    };
  }, [leftRef, rightRef, contentWidth, contentHeight, getContainerSize, setViewport]);
}

function getTouchDistance(touches: TouchList): number {
  const t0 = touches.item(0)!;
  const t1 = touches.item(1)!;
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

function getTouchCenter(touches: TouchList, rect: DOMRect) {
  const t0 = touches.item(0)!;
  const t1 = touches.item(1)!;
  return {
    x: (t0.clientX + t1.clientX) / 2 - rect.left,
    y: (t0.clientY + t1.clientY) / 2 - rect.top,
  };
}

/** Pinch-to-zoom on both containers. */
export function useSyncedPinch({
  leftRef,
  rightRef,
  contentWidth,
  contentHeight,
  getContainerSize,
  setViewport,
}: SyncedDeps) {
  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    let pinchState: { distance: number; zoom: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        setViewport((prev) => {
          pinchState = { distance: getTouchDistance(e.touches), zoom: prev.zoom };
          return prev;
        });
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchState) {
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        const newDist = getTouchDistance(e.touches);
        const scale = newDist / pinchState.distance;
        const newZoom = clampZoom(pinchState.zoom * scale);
        const rect = el.getBoundingClientRect();
        const center = getTouchCenter(e.touches, rect);
        setViewport((prev) => {
          const { clientWidth, clientHeight } = getContainerSize();
          const next = zoomAtPoint(prev, center.x, center.y, newZoom);
          return {
            scrollX: clampScroll(next.scrollX, contentWidth, clientWidth, next.zoom),
            scrollY: clampScroll(next.scrollY, contentHeight, clientHeight, next.zoom),
            zoom: next.zoom,
          };
        });
      }
    };

    const onTouchEnd = () => {
      pinchState = null;
    };

    for (const el of [leftEl, rightEl]) {
      if (!el) continue;
      el.addEventListener("touchstart", onTouchStart, { passive: false });
      el.addEventListener("touchmove", onTouchMove, { passive: false });
      el.addEventListener("touchend", onTouchEnd);
    }
    return () => {
      for (const el of [leftEl, rightEl]) {
        if (!el) continue;
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", onTouchEnd);
      }
    };
  }, [leftRef, rightRef, contentWidth, contentHeight, getContainerSize, setViewport]);
}

interface MouseDragDeps extends SyncedDeps {
  dragRef: MutableRefObject<{ startX: number; startY: number } | null>;
  setIsDragging: Dispatch<SetStateAction<boolean>>;
}

/** Mouse drag-to-pan on both containers. */
export function useSyncedMouseDrag({
  leftRef,
  rightRef,
  contentWidth,
  contentHeight,
  getContainerSize,
  setViewport,
  dragRef,
  setIsDragging,
}: MouseDragDeps) {
  useEffect(() => {
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY };
      setIsDragging(true);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      dragRef.current = { startX: e.clientX, startY: e.clientY };
      setViewport((prev) => {
        const { clientWidth, clientHeight } = getContainerSize();
        return {
          ...prev,
          scrollX: clampScroll(prev.scrollX - dx / prev.zoom, contentWidth, clientWidth, prev.zoom),
          scrollY: clampScroll(prev.scrollY - dy / prev.zoom, contentHeight, clientHeight, prev.zoom),
        };
      });
    };

    const onMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setIsDragging(false);
      }
    };

    if (leftEl) leftEl.addEventListener("mousedown", onMouseDown);
    if (rightEl) rightEl.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      if (leftEl) leftEl.removeEventListener("mousedown", onMouseDown);
      if (rightEl) rightEl.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [leftRef, rightRef, contentWidth, contentHeight, getContainerSize, setViewport, dragRef, setIsDragging]);
}

import { useCallback, useRef, useState } from "react";
import { clampScroll, zoomAtPoint, type ViewportState } from "../viewport";
import { getLifeSizeZoom } from "../zoomScale";
import { useSyncedReclamp, useSyncedWheel, useSyncedPinch, useSyncedMouseDrag } from "./useSyncedViewportEffects";

interface UseSyncedViewportOptions {
  leftContentWidth: number;
  leftContentHeight: number;
  rightContentWidth: number;
  rightContentHeight: number;
}

interface UseSyncedViewportResult {
  viewport: ViewportState;
  leftContainerRef: React.RefObject<HTMLDivElement | null>;
  rightContainerRef: React.RefObject<HTMLDivElement | null>;
  isDragging: boolean;
  resetViewport: () => void;
  setZoom: (zoom: number) => void;
  scrollTo: (scrollX: number, scrollY: number) => void;
}

/**
 * Manages a single synchronized viewport state for two side-by-side canvases.
 * Scrolling, dragging, or zooming on either canvas updates both.
 */
export function useSyncedViewport({
  leftContentWidth,
  leftContentHeight,
  rightContentWidth,
  rightContentHeight,
}: UseSyncedViewportOptions): UseSyncedViewportResult {
  const [viewport, setViewport] = useState<ViewportState>({
    scrollX: 0,
    scrollY: 0,
    zoom: getLifeSizeZoom(),
  });

  const leftContainerRef = useRef<HTMLDivElement | null>(null);
  const rightContainerRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  // Use the larger content dimensions for scroll clamping
  const contentWidth = Math.max(leftContentWidth, rightContentWidth);
  const contentHeight = Math.max(leftContentHeight, rightContentHeight);

  /** Get container dimensions (use whichever container is available). */
  const getContainerSize = useCallback(() => {
    const el = leftContainerRef.current ?? rightContainerRef.current;
    return {
      clientWidth: el?.clientWidth ?? 800,
      clientHeight: el?.clientHeight ?? 600,
    };
  }, []);

  const effectDeps = {
    leftRef: leftContainerRef,
    rightRef: rightContainerRef,
    contentWidth,
    contentHeight,
    getContainerSize,
    setViewport,
  };

  useSyncedReclamp(effectDeps);
  useSyncedWheel(effectDeps);
  useSyncedPinch(effectDeps);
  useSyncedMouseDrag({ ...effectDeps, dragRef, setIsDragging });

  const resetViewport = useCallback(() => {
    setViewport({ scrollX: 0, scrollY: 0, zoom: getLifeSizeZoom() });
  }, []);

  const scrollToPosition = useCallback(
    (sx: number, sy: number) => {
      const { clientWidth, clientHeight } = getContainerSize();
      setViewport((prev) => ({
        ...prev,
        scrollX: clampScroll(sx, contentWidth, clientWidth, prev.zoom),
        scrollY: clampScroll(sy, contentHeight, clientHeight, prev.zoom),
      }));
    },
    [contentWidth, contentHeight, getContainerSize],
  );

  const setZoomCentered = useCallback(
    (newZoom: number) => {
      const { clientWidth, clientHeight } = getContainerSize();
      setViewport((prev) => {
        const next = zoomAtPoint(prev, clientWidth / 2, clientHeight / 2, newZoom);
        return {
          scrollX: clampScroll(next.scrollX, contentWidth, clientWidth, next.zoom),
          scrollY: clampScroll(next.scrollY, contentHeight, clientHeight, next.zoom),
          zoom: next.zoom,
        };
      });
    },
    [contentWidth, contentHeight, getContainerSize],
  );

  return {
    viewport,
    leftContainerRef,
    rightContainerRef,
    isDragging,
    resetViewport,
    setZoom: setZoomCentered,
    scrollTo: scrollToPosition,
  };
}

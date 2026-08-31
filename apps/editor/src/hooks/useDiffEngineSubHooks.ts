/**
 * Sub-hooks extracted from useDiffEngine to reduce its size.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  GlyphAtlas,
  PerfTracker,
  TileCache,
  isTileCacheDisabled,
  isPerfEnabled,
  type DisplayList,
} from "@viritura/renderer";
import type { DiffNode } from "../diff/semanticDiff";
import type { MeasureDiffResult } from "../diff/measureDiff";
import type { MeasureBounds } from "../diff/measureBounds";
import { findNodeByMeasure } from "../components/diffTreeFind";
import { type FocusRect, repaintCanvas, paintDiffOverlays, paintFocusIndicator } from "./useDiffEngineHelpers";

interface CanvasRepaintArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  dl: DisplayList | null;
  side: "original" | "modified";
  bounds: MeasureBounds[];
  measureRects: Map<number, FocusRect>;
  measureDiff: MeasureDiffResult | null;
  focusedMeasure: number | null;
  viewport: { scrollX: number; scrollY: number; zoom: number };
  perfRef: MutableRefObject<PerfTracker>;
  glyphAtlasRef: MutableRefObject<GlyphAtlas | null>;
}

export function useCanvasRepaint({
  canvasRef,
  containerRef,
  dl,
  side,
  bounds,
  measureRects,
  measureDiff,
  focusedMeasure,
  viewport,
  perfRef,
  glyphAtlasRef,
}: CanvasRepaintArgs): void {
  // Per-side tile cache (original / modified each get their own). Mirrors how
  // every other view mode renders: pre-render the galley into zoom-scaled tiles
  // and blit the visible slice, instead of re-walking the command list each
  // scroll frame. Review lays the score out as a single unbroken galley, so the
  // tile cache runs in "horizon" mode.
  const tileCacheRef = useRef<TileCache | null>(null);
  // DisplayList identity → content version. Bumping it invalidates all tiles so
  // a re-layout (text edit, concert-pitch toggle) re-renders from scratch.
  const versionRef = useRef(0);
  const lastDlRef = useRef<DisplayList | null>(null);
  // Pending follow-up frame: the cache renders at most N new tiles per frame, so
  // a freshly-invalidated galley may need a couple of rAF passes to fill in.
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !dl) return;
    const dpr = window.devicePixelRatio || 1;
    // Only resize the backing store when the pixel dimensions actually change.
    // Assigning canvas.width/height reallocates and clears the buffer, so doing
    // it every scroll/zoom frame (this effect re-runs on `viewport` changes)
    // was needless churn on a large Review-mode score.
    const wPx = Math.round(container.clientWidth * dpr);
    const hPx = Math.round(container.clientHeight * dpr);
    if (canvas.width !== wPx || canvas.height !== hPx) {
      canvas.width = wPx;
      canvas.height = hPx;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
    }

    // Diff colour overlays + focus indicator paint on top of the score, in
    // content coordinates, so the ctx transform must match the score transform.
    // The tile blit leaves an identity transform, so set it here explicitly.
    const paintOverlays = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(
        dpr * viewport.zoom,
        0,
        0,
        dpr * viewport.zoom,
        -viewport.scrollX * dpr * viewport.zoom,
        -viewport.scrollY * dpr * viewport.zoom,
      );
      if (measureDiff && bounds.length > 0) {
        paintDiffOverlays(ctx, bounds, measureDiff, side, dl.height, focusedMeasure, measureRects);
      }
      if (focusedMeasure !== null) {
        const fr = measureRects.get(focusedMeasure) ?? null;
        if (fr) paintFocusIndicator(ctx, fr);
      }
      if (isPerfEnabled()) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        perfRef.current.drawOverlay(ctx, canvas.width, canvas.height);
      }
    };

    const endFrame = perfRef.current.beginFrame();

    if (isTileCacheDisabled()) {
      // Debug escape hatch: bypass tiling and paint commands directly.
      repaintCanvas(canvas, dl, viewport.scrollX, viewport.scrollY, viewport.zoom, glyphAtlasRef.current);
      paintOverlays();
      endFrame();
      return;
    }

    if (!tileCacheRef.current) tileCacheRef.current = new TileCache();
    const tileCache = tileCacheRef.current;
    if (lastDlRef.current !== dl) {
      lastDlRef.current = dl;
      versionRef.current += 1;
    }

    const paintTiles = () => {
      tileCache.paintFrame({
        canvas,
        displayList: dl,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
        zoom: viewport.zoom,
        version: versionRef.current,
        glyphAtlas: glyphAtlasRef.current,
        viewMode: "horizon",
        // Review keeps the flat white page it has always used.
        canvasBg: "#FFFFFF",
        paperFill: "#FFFFFF",
      });
      paintOverlays();
    };

    paintTiles();
    endFrame();

    // Fill in any tiles deferred past this frame's budget across subsequent
    // animation frames, repainting overlays on top each pass.
    cancelAnimationFrame(rafRef.current);
    const renderPending = () => {
      if (!tileCache.hasPendingTiles) return;
      rafRef.current = requestAnimationFrame(() => {
        paintTiles();
        renderPending();
      });
    };
    renderPending();

    return () => cancelAnimationFrame(rafRef.current);
  }, [
    canvasRef,
    containerRef,
    dl,
    side,
    bounds,
    measureRects,
    measureDiff,
    focusedMeasure,
    viewport,
    perfRef,
    glyphAtlasRef,
  ]);
}

interface CanvasClickArgs {
  leftContainerRef: React.RefObject<HTMLDivElement | null>;
  rightContainerRef: React.RefObject<HTMLDivElement | null>;
  originalBounds: MeasureBounds[];
  modifiedBounds: MeasureBounds[];
  viewport: { scrollX: number; scrollY: number; zoom: number };
  diffTree: DiffNode | null;
  setFocusedMeasure: (idx: number | null) => void;
  setSelectedDiffNode: (node: DiffNode | null) => void;
}

export function useCanvasMeasureClick({
  leftContainerRef,
  rightContainerRef,
  originalBounds,
  modifiedBounds,
  viewport,
  diffTree,
  setFocusedMeasure,
  setSelectedDiffNode,
}: CanvasClickArgs): void {
  const canvasClickStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const leftEl = leftContainerRef.current;
    const rightEl = rightContainerRef.current;
    const onMouseDown = (e: MouseEvent) => {
      canvasClickStart.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!canvasClickStart.current) return;
      const dx = Math.abs(e.clientX - canvasClickStart.current.x);
      const dy = Math.abs(e.clientY - canvasClickStart.current.y);
      canvasClickStart.current = null;
      if (dx > 4 || dy > 4) return;
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;
      const container = target.parentElement;
      if (!container) return;
      const isLeft = container === leftEl;
      const bounds = isLeft ? originalBounds : modifiedBounds;
      if (bounds.length === 0) return;
      const rect = target.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left) / viewport.zoom + viewport.scrollX;
      for (const mb of bounds) {
        if (canvasX >= mb.xStart && canvasX <= mb.xEnd) {
          setFocusedMeasure(mb.measureIndex);
          if (diffTree) {
            const node = findNodeByMeasure(diffTree, mb.measureIndex);
            if (node) setSelectedDiffNode(node);
          }
          return;
        }
      }
    };
    if (leftEl) {
      leftEl.addEventListener("mousedown", onMouseDown);
      leftEl.addEventListener("mouseup", onMouseUp);
    }
    if (rightEl) {
      rightEl.addEventListener("mousedown", onMouseDown);
      rightEl.addEventListener("mouseup", onMouseUp);
    }
    return () => {
      if (leftEl) {
        leftEl.removeEventListener("mousedown", onMouseDown);
        leftEl.removeEventListener("mouseup", onMouseUp);
      }
      if (rightEl) {
        rightEl.removeEventListener("mousedown", onMouseDown);
        rightEl.removeEventListener("mouseup", onMouseUp);
      }
    };
  }, [
    originalBounds,
    modifiedBounds,
    viewport,
    leftContainerRef,
    rightContainerRef,
    diffTree,
    setFocusedMeasure,
    setSelectedDiffNode,
  ]);
}

export function useSplitterDrag(
  splitPercent: number,
  setSplitPercent: (n: number) => void,
): { handleSplitterMouseDown: (e: React.MouseEvent) => void } {
  const isDraggingSplitter = useRef(false);
  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter.current = true;
  }, []);
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingSplitter.current) return;
      const container = document.getElementById("diff-main-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const percent = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitPercent(Math.min(80, Math.max(20, percent)));
    };
    const onMouseUp = () => {
      isDraggingSplitter.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [setSplitPercent]);
  void splitPercent;
  return { handleSplitterMouseDown };
}

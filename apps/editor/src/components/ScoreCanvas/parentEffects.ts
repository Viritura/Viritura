import { useEffect, useEffectEvent, useRef } from "react";
import type { DisplayList } from "@viritura/renderer";
import type { PageSetup } from "@viritura/core";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import { PX_PER_MM } from "./constants";
import { fitScoreView } from "./imperativeHandle";

interface FitToViewArgs {
  enabled: boolean | undefined;
  request: number | undefined;
  displayListRef: { current: DisplayList | null };
  displayListVersion: number;
  containerRef: { current: HTMLElement | null };
  viewport: { zoom: number; scrollX: number; scrollY: number };
  viewMode: ViewMode;
  setZoom: (zoom: number) => void;
  setScroll: (x: number, y: number) => void;
  safeArea?: { left?: number; right?: number; top?: number; bottom?: number };
}

export function useFitToViewZoom(args: FitToViewArgs): void {
  const { enabled, request, displayListVersion, containerRef, viewMode, safeArea } = args;
  const fit = useEffectEvent(() => {
    fitScoreView({
      displayList: args.displayListRef.current,
      container: containerRef.current,
      viewport: args.viewport,
      viewMode,
      setZoom: args.setZoom,
      setScroll: args.setScroll,
      safeArea,
      margin: 0,
    });
  });
  useEffect(() => {
    const element = containerRef.current;
    if (!enabled || !element) return;
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    return () => observer.disconnect();
  }, [
    enabled,
    request,
    displayListVersion,
    containerRef,
    viewMode,
    safeArea?.left,
    safeArea?.right,
    safeArea?.top,
    safeArea?.bottom,
  ]);
}

interface FitToWidthArgs {
  fitToWidth: boolean | undefined;
  containerWidth: number;
  contentWidth: number;
  initialZoom: number | undefined;
  /** Read-only — used as the baseline when `initialZoom` is undefined. */
  currentZoom: number;
  setZoom: (z: number) => void;
}

/**
 * Auto-shrink zoom so content fits in the container width. Triggered only on
 * container/content size changes (NOT on every viewport change) — a user's
 * manual wheel-zoom is preserved until the next resize or content edit. Never
 * zooms IN past `initialZoom`; only shrinks to make oversized content fit.
 */
export function useFitToWidthZoom(args: FitToWidthArgs): void {
  const { fitToWidth, containerWidth, contentWidth, initialZoom, currentZoom, setZoom } = args;
  const lastFitTargetRef = useRef<number | null>(null);
  useEffect(() => {
    if (!fitToWidth) return;
    if (containerWidth <= 0 || contentWidth <= 0) return;
    const baseZoom = initialZoom ?? currentZoom;
    const margin = 24; // matches START_ANCHOR_PAD_PX-ish breathing room
    const usable = Math.max(1, containerWidth - margin * 2);
    const fitZoom = usable / contentWidth;
    const target = Math.max(0.05, Math.min(baseZoom, fitZoom));
    // Tolerance check: avoid setZoom() for sub-pixel float differences which
    // would otherwise cascade into a ResizeObserver/re-layout flap when the
    // container width fluctuates by ≤1px (browser-zoom rounding, scrollbar
    // appearance/disappearance, etc.).
    const prev = lastFitTargetRef.current;
    if (prev === null || Math.abs(prev - target) > 1e-4) {
      lastFitTargetRef.current = target;
      setZoom(target);
    }
    // Intentionally exclude `currentZoom` and `setZoom` from deps — we only
    // want to react to size changes, not to the zoom we just set.
  }, [fitToWidth, containerWidth, contentWidth, initialZoom]);
}

interface ParentNotificationsArgs {
  viewport: { zoom: number; scrollX: number; scrollY: number };
  scoreInfo: string;
  scoreDefinitions: string[];
  displayListRef: { current: DisplayList | null };
  displayListVersion: number;
  onViewportChange?: (v: { zoom: number; scrollX: number; scrollY: number }) => void;
  onScoreInfoChange?: (info: string) => void;
  onLayoutsChange?: (defs: string[]) => void;
  onPageCountChange?: (count: number) => void;
  onPrintOverflowChange?: (pages: number[]) => void;
  pageSetupRef: { current: PageSetup };
  viewMode: ViewMode;
}

export function printOverflowPages(displayList: DisplayList | null, bottomMarginPx: number): number[] {
  const pages = displayList?.pages ?? [];
  const bounds = displayList?.measureBounds ?? [];
  // The engine measures all emitted ink, including dynamics, lyrics, and curves.
  const overflow = new Set<number>((displayList?.pageOverflows ?? []).map((entry) => entry.pageNumber + 1));
  if (pages.length === 0 || bounds.length === 0) return [...overflow].sort((a, b) => a - b);

  for (const bound of bounds) {
    if (bound.isHidden || bound.ghostStaff) continue;
    const page = pages.find(
      (candidate) => bound.y >= candidate.yOffset && bound.y < candidate.yOffset + candidate.height,
    );
    if (!page) continue;
    const printableBottom = page.yOffset + page.height - bottomMarginPx;
    if (bound.y + bound.height > printableBottom + 0.5) {
      overflow.add(page.pageNumber + 1);
    }
  }
  return [...overflow].sort((a, b) => a - b);
}

/**
 * Fire optional `on*Change` callbacks when their respective state inputs
 * change. Page-view consumers like Publish drive page navigation UI off
 * `onPageCountChange`.
 */
export function useParentNotifications(args: ParentNotificationsArgs): void {
  const {
    viewport,
    scoreInfo,
    scoreDefinitions,
    displayListRef,
    displayListVersion,
    onViewportChange,
    onScoreInfoChange,
    onLayoutsChange,
    onPageCountChange,
    onPrintOverflowChange,
    pageSetupRef,
    viewMode,
  } = args;

  useEffect(() => {
    onViewportChange?.({ zoom: viewport.zoom, scrollX: viewport.scrollX, scrollY: viewport.scrollY });
  }, [viewport, onViewportChange]);

  useEffect(() => {
    onScoreInfoChange?.(scoreInfo);
  }, [scoreInfo, onScoreInfoChange]);

  useEffect(() => {
    onLayoutsChange?.(scoreDefinitions);
  }, [scoreDefinitions, onLayoutsChange]);

  useEffect(() => {
    onPageCountChange?.(displayListRef.current?.pages?.length ?? 0);
  }, [displayListVersion, onPageCountChange]);

  useEffect(() => {
    const pages =
      viewMode === "horizon"
        ? []
        : printOverflowPages(displayListRef.current, pageSetupRef.current.margins.bottom * PX_PER_MM);
    onPrintOverflowChange?.(pages);
  }, [displayListVersion, onPrintOverflowChange, pageSetupRef, viewMode]);
}

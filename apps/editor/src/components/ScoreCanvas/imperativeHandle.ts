import type { DisplayList, SpatialIndex } from "@viritura/renderer";
import { computeHorizonPaperGeometry } from "@viritura/renderer";
import { computePagePlacements, PAGE_STACK_GAP } from "./viewportGeometry";
import { defaultPageSetupForScore } from "@viritura/core";
import type { PageSetup, Score } from "@viritura/core";

interface ImperativeHandleArgs {
  setZoom: (z: number) => void;
  setScroll: (x: number, y: number) => void;
  resetViewport: () => void;
  scoreDefinitions: string[];
  selectedScoreIndex: number;
  viewport: { zoom: number; scrollX: number; scrollY: number };
  displayListRef: { current: DisplayList | null };
  spatialIndexRef: { current: SpatialIndex | null };
  canvasRef: { current: HTMLCanvasElement | null };
  containerRef: { current: HTMLElement | null };
  docScoreRef: { current: Score | null };
  viewMode: "page" | "spread" | "spread-h" | "horizon";
}

export interface ScoreCanvasHandle {
  setZoom: (z: number) => void;
  setScroll: (x: number, y: number) => void;
  resetViewport: () => void;
  scoreDefinitions: string[];
  getDisplayList: () => DisplayList | null;
  getPageSetup: () => PageSetup;
  getSpatialIndex: () => SpatialIndex | null;
  getCanvasElement: () => HTMLCanvasElement | null;
  getViewportElement: () => HTMLElement | null;
  getViewport: () => { zoom: number; scrollX: number; scrollY: number };
  getPageCount: () => number;
  scrollToPage: (index: number) => void;
  scrollToMeasure: (measureIndex: number) => void;
  getCurrentPageIndex: () => number;
  fitPage: () => void;
  fitWidth: () => void;
}

/** Build the imperative handle exposed via `forwardRef` from `ScoreCanvas`. */
export function buildScoreCanvasHandle(args: ImperativeHandleArgs): ScoreCanvasHandle {
  const {
    setZoom,
    setScroll,
    resetViewport,
    scoreDefinitions,
    selectedScoreIndex,
    viewport,
    displayListRef,
    spatialIndexRef,
    canvasRef,
    containerRef,
    docScoreRef,
    viewMode,
  } = args;
  return {
    setZoom,
    setScroll,
    resetViewport,
    scoreDefinitions,
    getDisplayList: () => displayListRef.current,
    getPageSetup: () => {
      const scores = docScoreRef.current?.scores;
      const activeScoreDef = scores?.[selectedScoreIndex];
      const defaults = defaultPageSetupForScore(
        scores,
        selectedScoreIndex,
        docScoreRef.current?.layouts,
        docScoreRef.current?.parts?.length,
        docScoreRef.current?.pageSetupDefaults,
      );
      return {
        ...defaults,
        ...activeScoreDef?.pageSetup,
        margins: { ...defaults.margins, ...activeScoreDef?.pageSetup?.margins },
      };
    },
    getSpatialIndex: () => spatialIndexRef.current,
    getCanvasElement: () => canvasRef.current,
    getViewportElement: () => containerRef.current,
    getViewport: () => ({ zoom: viewport.zoom, scrollX: viewport.scrollX, scrollY: viewport.scrollY }),
    getPageCount: () => displayListRef.current?.pages?.length ?? 0,
    scrollToPage: (index: number) => scrollToPage(index, displayListRef, setScroll),
    scrollToMeasure: (measureIndex: number) =>
      scrollToMeasure(measureIndex, displayListRef, containerRef, viewport, viewMode, setScroll),
    getCurrentPageIndex: () => currentPageIndex(displayListRef, containerRef, viewport, viewMode),
    fitPage: () =>
      fitScoreView({
        displayList: displayListRef.current,
        container: containerRef.current,
        viewport,
        viewMode,
        setZoom,
        setScroll,
      }),
    fitWidth: () => fitWidthImpl(displayListRef, containerRef, setZoom),
  };
}

export function measureVisualPosition(
  displayList: DisplayList,
  measureIndex: number,
  viewMode: "page" | "spread" | "spread-h" | "horizon",
): { x: number; y: number } | null {
  const matchingBounds = displayList.measureBounds?.filter((bound) => bound.index === measureIndex);
  if (!matchingBounds?.length) return null;
  const left = Math.min(...matchingBounds.map((bound) => bound.x));
  const right = Math.max(...matchingBounds.map((bound) => bound.x + bound.width));
  const top = Math.min(...matchingBounds.map((bound) => bound.y));
  const bottom = Math.max(...matchingBounds.map((bound) => bound.y + bound.height));
  const engineCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const placement = computePagePlacements(displayList, viewMode).find(
    (page) => engineCenter.y >= page.engineYOffset && engineCenter.y < page.engineYOffset + page.height,
  );
  if (!placement) return engineCenter;
  return {
    x: engineCenter.x + placement.x,
    y: engineCenter.y + placement.y - placement.engineYOffset,
  };
}

export function centeredScrollPosition(
  position: { x: number; y: number },
  visibleWidth: number,
  visibleHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, position.x - visibleWidth / 2),
    y: Math.max(0, position.y - visibleHeight / 2),
  };
}

function scrollToMeasure(
  measureIndex: number,
  displayListRef: { current: DisplayList | null },
  containerRef: { current: HTMLElement | null },
  viewport: { zoom: number },
  viewMode: "page" | "spread" | "spread-h" | "horizon",
  setScroll: (x: number, y: number) => void,
): void {
  const displayList = displayListRef.current;
  if (!displayList) return;
  const position = measureVisualPosition(displayList, measureIndex, viewMode);
  if (!position) return;
  const container = containerRef.current;
  const visibleWidth = container ? container.clientWidth / viewport.zoom : 0;
  const visibleHeight = container ? container.clientHeight / viewport.zoom : 0;
  const scroll = centeredScrollPosition(position, visibleWidth, visibleHeight);
  setScroll(scroll.x, scroll.y);
}

function scrollToPage(
  index: number,
  displayListRef: { current: DisplayList | null },
  setScroll: (x: number, y: number) => void,
): void {
  const pages = displayListRef.current?.pages;
  if (!pages || pages.length === 0) return;
  const clamped = Math.max(0, Math.min(pages.length - 1, index));
  const page = pages[clamped]!;
  // Pages stacked vertically at x=0 in page view (PAGE_STACK_GAP between);
  // nudge a small top margin so the page edge isn't flush with the viewport top.
  const visualY = page.yOffset + clamped * PAGE_STACK_GAP;
  setScroll(0, Math.max(0, visualY - 8));
}

function currentPageIndex(
  displayListRef: { current: DisplayList | null },
  containerRef: { current: HTMLElement | null },
  viewport: { zoom: number; scrollX: number; scrollY: number },
  viewMode: ImperativeHandleArgs["viewMode"],
): number {
  const displayList = displayListRef.current;
  if (!displayList) return 0;
  const el = containerRef.current;
  const centerX = viewport.scrollX + (el ? el.clientWidth / viewport.zoom / 2 : 0);
  const centerY = viewport.scrollY + (el ? el.clientHeight / viewport.zoom / 2 : 0);
  let best = 0;
  let bestDistance = Infinity;
  for (const page of computePagePlacements(displayList, viewMode)) {
    const dx = Math.max(page.x - centerX, 0, centerX - page.x - page.width);
    const dy = Math.max(page.y - centerY, 0, centerY - page.y - page.height);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = page.pageIndex;
      bestDistance = distance;
    }
  }
  return best;
}

interface FitScoreViewArgs {
  displayList: DisplayList | null;
  container: HTMLElement | null;
  viewport: ImperativeHandleArgs["viewport"];
  viewMode: ImperativeHandleArgs["viewMode"];
  setZoom: (zoom: number) => void;
  setScroll: (x: number, y: number) => void;
  safeArea?: { left?: number; right?: number; top?: number; bottom?: number };
  margin?: number;
}

export function scorePageFrame(
  dl: DisplayList,
  viewMode: ImperativeHandleArgs["viewMode"],
  index: number,
): { x: number; y: number; width: number; height: number } | null {
  const first = viewMode === "page" || index === 0 ? index : index % 2 === 1 ? index : index - 1;
  const frame = computePagePlacements(dl, viewMode).filter(
    (page) => page.pageIndex === first || (viewMode !== "page" && first > 0 && page.pageIndex === first + 1),
  );
  if (frame.length === 0) return null;
  const x = Math.min(...frame.map((page) => page.x));
  const y = Math.min(...frame.map((page) => page.y));
  return {
    x,
    y,
    width: Math.max(...frame.map((page) => page.x + page.width)) - x,
    height: Math.max(...frame.map((page) => page.y + page.height)) - y,
  };
}

export function fitScoreView({
  displayList: dl,
  container: el,
  viewport,
  viewMode,
  setZoom,
  setScroll,
  safeArea,
  margin = 24,
}: FitScoreViewArgs): void {
  if (!dl || !el || el.clientWidth <= 0 || el.clientHeight <= 0) return;
  const { left = 0, right = 0, top = 0, bottom = 0 } = safeArea ?? {};
  const usableWidth = Math.max(1, el.clientWidth - left - right - margin * 2);
  const usableHeight = Math.max(1, el.clientHeight - top - bottom - margin * 2);
  const centerX = (el.clientWidth + left - right) / 2;
  const centerY = (el.clientHeight + top - bottom) / 2;
  if (viewMode === "horizon") {
    const height = computeHorizonPaperGeometry(dl).contentHeight;
    if (height <= 0) return;
    const zoom = Math.max(0.05, Math.min(16, usableHeight / height));
    setZoom(zoom);
    setScroll(viewport.scrollX, height / 2 - centerY / zoom);
    return;
  }
  const index = currentPageIndex({ current: dl }, { current: el }, viewport, viewMode);
  const frame = scorePageFrame(dl, viewMode, index);
  if (!frame) return;
  const { x, y, width, height } = frame;
  if (width <= 0 || height <= 0) return;
  const fitWidth = viewMode === "page" ? width : Math.max(width, dl.width * 2);
  const zoom = Math.max(0.05, Math.min(16, usableWidth / fitWidth, usableHeight / height));
  setZoom(zoom);
  setScroll(x + width / 2 - centerX / zoom, y + height / 2 - centerY / zoom);
}

function fitWidthImpl(
  displayListRef: { current: DisplayList | null },
  containerRef: { current: HTMLElement | null },
  setZoom: (z: number) => void,
): void {
  const dl = displayListRef.current;
  const el = containerRef.current;
  if (!dl || !el) return;
  const margin = 24;
  setZoom(Math.max(0.05, (el.clientWidth - margin * 2) / dl.width));
}

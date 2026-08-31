import type { DisplayList, SpatialIndex } from "@viritura/renderer";
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
  resetViewport: () => void;
  scoreDefinitions: string[];
  getDisplayList: () => DisplayList | null;
  getPageSetup: () => PageSetup;
  getSpatialIndex: () => SpatialIndex | null;
  getCanvasElement: () => HTMLCanvasElement | null;
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
      );
      return {
        ...defaults,
        ...activeScoreDef?.pageSetup,
        margins: { ...defaults.margins, ...activeScoreDef?.pageSetup?.margins },
      };
    },
    getSpatialIndex: () => spatialIndexRef.current,
    getCanvasElement: () => canvasRef.current,
    getViewport: () => ({ zoom: viewport.zoom, scrollX: viewport.scrollX, scrollY: viewport.scrollY }),
    getPageCount: () => displayListRef.current?.pages?.length ?? 0,
    scrollToPage: (index: number) => scrollToPage(index, displayListRef, setScroll),
    scrollToMeasure: (measureIndex: number) =>
      scrollToMeasure(measureIndex, displayListRef, containerRef, viewport, viewMode, setScroll),
    getCurrentPageIndex: () => currentPageIndex(displayListRef, containerRef, viewport),
    fitPage: () => fitPageImpl(displayListRef, containerRef, setZoom),
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
  viewport: { zoom: number; scrollY: number },
): number {
  const pages = displayListRef.current?.pages;
  if (!pages || pages.length === 0) return 0;
  const el = containerRef.current;
  const vhWorld = el ? el.clientHeight / viewport.zoom : 0;
  const centerY = viewport.scrollY + vhWorld / 2;
  let best = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const bandTop = p.yOffset + i * PAGE_STACK_GAP;
    if (centerY >= bandTop && centerY < bandTop + p.height) return i;
    if (bandTop <= centerY) best = i;
  }
  return best;
}

function fitPageImpl(
  displayListRef: { current: DisplayList | null },
  containerRef: { current: HTMLElement | null },
  setZoom: (z: number) => void,
): void {
  const dl = displayListRef.current;
  const el = containerRef.current;
  if (!dl || !dl.pages || dl.pages.length === 0 || !el) return;
  const page = dl.pages[0]!;
  const margin = 24; // breathing room so the page edge isn't flush
  const fitW = (el.clientWidth - margin * 2) / dl.width;
  const fitH = (el.clientHeight - margin * 2) / page.height;
  setZoom(Math.max(0.05, Math.min(fitW, fitH)));
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

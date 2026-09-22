/* eslint-disable react-refresh/only-export-components --
 * Colocates the ScoreView component with its ScoreViewContext + useScoreView
 * hook so descendants can read view metrics. Splitting would fork consumer
 * imports in @viritura/score-viewer-react without benefit. */
/**
 * <ScoreView> - low-level, read-only music score renderer.
 *
 * It owns the engine/layout/canvas paint lifecycle, while higher-level viewer
 * chrome such as zoom and view-mode controls lives in <ScoreViewer>.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { computeHorizonPaperGeometry, detectStavesForViewMode, TileCache } from "@viritura/renderer";
import type {
  DisplayList,
  Engine,
  EngineLoadError,
  LayoutError,
  LayoutOptions,
  PageLayout,
  ParseError,
} from "@viritura/score-engine";
import { useScoreEngine } from "./useScoreEngine";
import { resolveScorePlayheadGeometry } from "./playheadGeometry";

export type ScoreViewMode = "page" | "horizontal" | "spread" | "spread-horizontal" | "horizon";
export type ScoreSpreadFirstPage = "single" | "paired";

export interface ScorePageMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ScorePagePosition {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScoreViewProps {
  /** MNX document (string or parsed object). */
  mnx: string | object;
  /** Base URL containing `wasm/` and `fonts/` folders. */
  assetBaseUrl?: string;
  /** Page width in display-list units. */
  pageWidth?: number;
  /** Page height in display-list units. Defaults to the A4 aspect ratio. */
  pageHeight?: number;
  /** Page margins in display-list units. Defaults to 15 mm scaled to the page width. */
  pageMargins?: ScorePageMargins;
  /** Staff space height in pixels. Default 7. */
  spatium?: number;
  /** Index into MNX `scores[]` to render. Default 0. */
  scoreIndex?: number;
  /** Page arrangement mode. Default `page`. */
  viewMode?: ScoreViewMode;
  /** Zoom level. 1.0 = 1:1 with display-list pixels. */
  zoom?: number;
  /** Gap between pages in CSS pixels. Default 16. */
  gap?: number;
  /** Whether page 1 stands alone in spread modes. Default `single`. */
  spreadFirstPage?: ScoreSpreadFirstPage;
  /** Legacy column count for `viewMode="page"`. Default 1. */
  pagesPerRow?: number;
  /** Callback when the engine + layout are ready. */
  onReady?: (info: { engine: Engine; displayList: DisplayList }) => void;
  /** Callback after the current display list has been painted to every page canvas. */
  onPaint?: (info: { engine: Engine; displayList: DisplayList }) => void;
  /** Callback when an error occurs. */
  onError?: (err: EngineLoadError | ParseError | LayoutError) => void;
  /** Class for the root score surface. */
  className?: string;
  /** Inline style for the root score surface. */
  style?: CSSProperties;
  /** Class applied to each page canvas. */
  pageClassName?: string;
  /** Inline style applied to each page canvas. */
  pageStyle?: CSSProperties;
  /** Fill color painted behind the score on each page canvas. Defaults to
   *  `"#ffffff"` (a paper-white page). Pass `"transparent"` to render the
   *  music with no page fill so it blends into the host surface. */
  pageBackground?: string;
  /** Loading slot. Defaults to a small loading indicator. */
  loadingFallback?: ReactNode;
  /** Error slot. Defaults to inline error text. */
  errorFallback?: (err: Error) => ReactNode;
  /** Children render absolutely-positioned over the score. */
  children?: ReactNode;
}

interface PageLayoutResult {
  readonly positions: readonly ScorePagePosition[];
  readonly width: number;
  readonly height: number;
}

interface ScoreViewContextValue {
  engine: Engine | null;
  displayList: DisplayList | null;
  zoom: number;
  pageLayouts: readonly PageLayout[];
  pagePositions: readonly ScorePagePosition[];
  /** Current view mode, so overlays can resolve staff rows the same way the surface lays them out. */
  viewMode: ScoreViewMode;
}

const ScoreViewContext = createContext<ScoreViewContextValue | null>(null);

export function useScoreView(): ScoreViewContextValue {
  const value = useContext(ScoreViewContext);
  if (!value) throw new Error("useScoreView must be used inside <ScoreView>");
  return value;
}

const SCOREVIEW_ERROR_INNER_STYLE: CSSProperties = { color: "#b00", padding: 16 };
const SCOREVIEW_LOADING_INNER_STYLE: CSSProperties = { padding: 16, color: "#666" };
const PLAYHEAD_BAR_STYLE: CSSProperties = { width: 2, height: "100%", background: "currentColor" };
const HORIZON_CANVAS_STYLE: CSSProperties = {
  position: "sticky",
  left: 0,
  top: 0,
  display: "block",
  pointerEvents: "none",
};

function buildLayoutOptions(args: {
  pageWidth: number;
  resolvedPageHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  spatium: number;
  scoreIndex: number;
}): LayoutOptions {
  const { pageWidth, resolvedPageHeight, marginTop, marginRight, marginBottom, marginLeft, spatium, scoreIndex } = args;
  return {
    pageWidth,
    spatium,
    scoreIndex,
    pageSetup:
      pageWidth > 0
        ? {
            height: resolvedPageHeight,
            margins: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
          }
        : undefined,
  };
}

function usesPagedLayout(viewMode: ScoreViewMode, pageWidth: number): boolean {
  return viewMode !== "horizon" && pageWidth > 0;
}

function renderScoreStatus(args: {
  error: Error | null;
  loading: boolean;
  displayList: DisplayList | null;
  className?: string;
  style?: CSSProperties;
  loadingFallback?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
}): ReactNode | null {
  const { error, loading, displayList, className, style, loadingFallback, errorFallback } = args;
  if (error) {
    return (
      <div className={className} style={style}>
        {errorFallback ? (
          errorFallback(error)
        ) : (
          <div style={SCOREVIEW_ERROR_INNER_STYLE}>Score error: {error.message}</div>
        )}
      </div>
    );
  }
  if (loading || !displayList) {
    return (
      <div className={className} style={style}>
        {loadingFallback ?? <div style={SCOREVIEW_LOADING_INNER_STYLE}>Loading score...</div>}
      </div>
    );
  }
  return null;
}

function assertDisplayList(displayList: DisplayList | null): asserts displayList is DisplayList {
  if (!displayList) throw new Error("Score display list is unavailable after loading completed.");
}

function scorePageContainerStyle(
  pagePosition: { x: number; y: number; width: number; height: number },
  style: CSSProperties | undefined,
): CSSProperties {
  return {
    position: "absolute",
    left: pagePosition.x,
    top: pagePosition.y,
    width: pagePosition.width,
    height: pagePosition.height,
    pointerEvents: "none",
    ...style,
  };
}
function playheadContainerStyle(
  left: number,
  top: number,
  height: number,
  style: CSSProperties | undefined,
): CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    height,
    pointerEvents: "none",
    ...style,
  };
}
function scoreViewRootStyle(width: number, height: number, style: CSSProperties | undefined): CSSProperties {
  return {
    position: "relative",
    width,
    height,
    ...style,
  };
}
function scorePageCanvasStyle(
  pagePosition: { x: number; y: number } | undefined,
  pageStyle: CSSProperties | undefined,
  pageBackground: string,
): CSSProperties {
  const transparent = pageBackground === "transparent";
  return {
    position: "absolute",
    left: pagePosition?.x ?? 0,
    top: pagePosition?.y ?? 0,
    background: pageBackground,
    ...(transparent ? {} : { boxShadow: "0 2px 14px rgba(0, 0, 0, 0.24)" }),
    ...pageStyle,
  };
}

interface HorizonScoreSurfaceProps {
  readonly displayList: DisplayList;
  readonly zoom: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly pageBackground: string;
  readonly onPaint?: () => void;
  readonly children?: ReactNode;
}

function HorizonScoreSurface({
  displayList,
  zoom,
  className,
  style,
  pageBackground,
  onPaint,
  children,
}: HorizonScoreSurfaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const displayListVersionRef = useRef(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [tileCache] = useState(() => new TileCache());
  const paper = useMemo(() => computeHorizonPaperGeometry(displayList), [displayList]);
  const notifyPaint = useEffectEvent(() => onPaint?.());

  useEffect(() => {
    displayListVersionRef.current += 1;
    tileCache.invalidate();
  }, [displayList, tileCache]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const viewport = root?.parentElement;
    if (!root || !canvas || !viewport) return;

    const renderFrame = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (canvas.width !== Math.ceil(width * dpr)) canvas.width = Math.ceil(width * dpr);
      if (canvas.height !== Math.ceil(height * dpr)) canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      setViewportSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
      tileCache.paintFrame({
        canvas,
        displayList,
        scrollX: viewport.scrollLeft / zoom,
        scrollY: viewport.scrollTop / zoom,
        zoom,
        version: displayListVersionRef.current,
        glyphAtlas: null,
        viewMode: "horizon",
        canvasBg: "rgba(0, 0, 0, 0)",
        paperFill: pageBackground,
      });
      if (tileCache.hasPendingTiles) {
        frameRef.current = requestAnimationFrame(renderFrame);
      } else {
        notifyPaint();
      }
    };

    const schedulePaint = () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(renderFrame);
    };

    const observer = new ResizeObserver(schedulePaint);
    observer.observe(viewport);
    viewport.addEventListener("scroll", schedulePaint, { passive: true });
    renderFrame();
    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      viewport.removeEventListener("scroll", schedulePaint);
    };
  }, [displayList, pageBackground, tileCache, zoom]);

  const rootStyle: CSSProperties = {
    position: "relative",
    width: paper.width * zoom,
    height: Math.max(paper.contentHeight * zoom, viewportSize.height),
    ...style,
  };

  return (
    <div ref={rootRef} className={className} style={rootStyle}>
      <canvas ref={canvasRef} style={HORIZON_CANVAS_STYLE} />
      {children}
    </div>
  );
}

interface ScorePageProps {
  page: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function ScorePage({ page, children, className, style }: ScorePageProps) {
  const { pagePositions } = useScoreView();
  const pagePosition = pagePositions[page];
  if (!pagePosition) return null;

  return (
    <div className={className} style={scorePageContainerStyle(pagePosition, style)} data-page={page}>
      {children}
    </div>
  );
}

interface ScorePlayheadProps {
  beat?: number;
  position?: { readonly measureIndex: number; readonly beat: number };
  partId?: string;
  follow?: boolean;
  render?: (pos: { x: number; y: number; height: number }) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

interface ScorePlayheadMarkerProps {
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly follow: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}

function ScorePlayheadMarker({ left, top, height, follow, className, style, children }: ScorePlayheadMarkerProps) {
  const playheadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = playheadRef.current;
    const viewport = element?.parentElement?.parentElement;
    if (!follow || !element || !viewport) return;
    const cursor = element.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    if (cursor.left < visible.left || cursor.right > visible.right) {
      viewport.scrollLeft += cursor.left - visible.left - visible.width / 3;
    }
    if (cursor.top < visible.top || cursor.bottom > visible.bottom) {
      viewport.scrollTop += cursor.top - visible.top - visible.height / 2;
    }
  }, [follow, left, top]);

  return (
    <div
      ref={playheadRef}
      className={className}
      style={playheadContainerStyle(left, top, height, { zIndex: 5, color: "#e34935", ...style })}
      data-score-playhead="true"
    >
      {children}
    </div>
  );
}

function ScorePlayhead({ beat, position, partId, follow = false, render, className, style }: ScorePlayheadProps) {
  const { engine, displayList, zoom, pageLayouts, pagePositions, viewMode } = useScoreView();
  // Bounds-aware detection so staves with non-standard line counts (e.g.
  // single-line percussion) still yield a row for the playhead to span.
  const staves = useMemo(
    () => (displayList ? detectStavesForViewMode(displayList, viewMode === "horizon" ? "horizon" : "page") : []),
    [displayList, viewMode],
  );
  const geometry = resolveScorePlayheadGeometry({
    engine,
    displayList,
    beat,
    position,
    partId,
    zoom,
    pageLayouts,
    pagePositions,
    staves,
  });
  if (!geometry) return null;

  return (
    <ScorePlayheadMarker
      left={geometry.left}
      top={geometry.top}
      height={geometry.height}
      follow={follow}
      className={className}
      style={style}
    >
      {render ? (
        render({ x: geometry.sourceX, y: geometry.localY, height: geometry.sourceHeight })
      ) : (
        <div style={PLAYHEAD_BAR_STYLE} />
      )}
    </ScorePlayheadMarker>
  );
}

export function ScoreView({
  mnx,
  assetBaseUrl,
  pageWidth = 800,
  pageHeight,
  pageMargins,
  spatium = 7,
  scoreIndex = 0,
  viewMode = "page",
  zoom = 1,
  gap = 16,
  spreadFirstPage = "single",
  pagesPerRow = 1,
  onReady,
  onPaint,
  onError,
  className,
  style,
  pageClassName,
  pageStyle,
  pageBackground = "#ffffff",
  loadingFallback,
  errorFallback,
  children,
}: ScoreViewProps) {
  const defaultMargin = pageWidth * (15 / 210);
  const resolvedPageHeight = pageHeight ?? pageWidth * (297 / 210);
  const marginTop = pageMargins?.top ?? defaultMargin;
  const marginRight = pageMargins?.right ?? defaultMargin;
  const marginBottom = pageMargins?.bottom ?? defaultMargin;
  const marginLeft = pageMargins?.left ?? defaultMargin;
  const layoutPageWidth = viewMode === "horizon" ? 0 : pageWidth;
  const layoutOpts = useMemo(
    () =>
      buildLayoutOptions({
        pageWidth: layoutPageWidth,
        resolvedPageHeight,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
        spatium,
        scoreIndex,
      }),
    [layoutPageWidth, marginBottom, marginLeft, marginRight, marginTop, resolvedPageHeight, scoreIndex, spatium],
  );
  const engineOptions = useMemo(() => ({ assetBaseUrl }), [assetBaseUrl]);
  const { engine, displayList, error, loading } = useScoreEngine(mnx, layoutOpts, engineOptions);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const notifyPaint = useEffectEvent(() => {
    if (engine && displayList) onPaint?.({ engine, displayList });
  });

  const pageLayouts = useMemo(
    () => (displayList ? getPageLayouts(displayList, usesPagedLayout(viewMode, pageWidth)) : []),
    [displayList, pageWidth, viewMode],
  );
  const pageLayoutResult = useMemo(
    () =>
      computePageLayout({
        pageLayouts,
        pageWidth: displayList?.width ?? pageWidth,
        zoom,
        gap,
        viewMode,
        pagesPerRow,
        spreadFirstPage,
      }),
    [displayList?.width, gap, pageLayouts, pageWidth, pagesPerRow, spreadFirstPage, viewMode, zoom],
  );

  useEffect(() => {
    if (engine && displayList && onReady) onReady({ engine, displayList });
  }, [engine, displayList, onReady]);

  useEffect(() => {
    if (error && onError) onError(error);
  }, [error, onError]);

  useEffect(() => {
    if (!engine || !displayList || viewMode === "horizon") return;
    const layouts = getPageLayouts(displayList, pageWidth > 0);
    layouts.forEach((pageLayout, pageIndex) => {
      const canvas = canvasRefs.current[pageIndex];
      if (!canvas) return;
      const devicePixelRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const pageWidthValue = displayList.width;
      canvas.width = Math.ceil(pageWidthValue * zoom * devicePixelRatio);
      canvas.height = Math.ceil(pageLayout.height * zoom * devicePixelRatio);
      canvas.style.width = `${pageWidthValue * zoom}px`;
      canvas.style.height = `${pageLayout.height * zoom}px`;
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) return;
      canvasContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      canvasContext.clearRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
      if (pageBackground !== "transparent") {
        canvasContext.fillStyle = pageBackground;
        canvasContext.fillRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
      }
      engine.paint(canvasContext, displayList, {
        page: pageIndex,
        zoom,
        background: pageBackground === "transparent" ? null : pageBackground,
      });
    });
    notifyPaint();
  }, [engine, displayList, pageBackground, pageWidth, viewMode, zoom]);

  const setCanvasRef = useCallback(
    (pageIndex: number) => (element: HTMLCanvasElement | null) => {
      canvasRefs.current[pageIndex] = element;
    },
    [],
  );

  const status = renderScoreStatus({
    error,
    loading,
    displayList,
    className,
    style,
    loadingFallback,
    errorFallback,
  });
  if (status) return status;
  assertDisplayList(displayList);

  const contextValue: ScoreViewContextValue = {
    engine,
    displayList,
    zoom,
    pageLayouts,
    pagePositions: pageLayoutResult.positions,
    viewMode,
  };

  if (viewMode === "horizon") {
    return (
      <ScoreViewContext.Provider value={contextValue}>
        <HorizonScoreSurface
          displayList={displayList}
          zoom={zoom}
          className={className}
          style={style}
          pageBackground={pageBackground}
          onPaint={() => {
            if (engine) onPaint?.({ engine, displayList });
          }}
        >
          {children}
        </HorizonScoreSurface>
      </ScoreViewContext.Provider>
    );
  }

  return (
    <ScoreViewContext.Provider value={contextValue}>
      <div className={className} style={scoreViewRootStyle(pageLayoutResult.width, pageLayoutResult.height, style)}>
        {pageLayouts.map((_, pageIndex) => {
          const pagePosition = pageLayoutResult.positions[pageIndex];
          return (
            <canvas
              key={pageIndex}
              ref={setCanvasRef(pageIndex)}
              className={pageClassName}
              data-page={pageIndex}
              style={scorePageCanvasStyle(pagePosition, pageStyle, pageBackground)}
            />
          );
        })}
        {children}
      </div>
    </ScoreViewContext.Provider>
  );
}

function getPageLayouts(displayList: DisplayList, paged: boolean): PageLayout[] {
  if (paged && displayList.pages?.length) return displayList.pages;
  return [{ pageNumber: 1, systemIndices: [], yOffset: 0, height: displayList.height }];
}

interface ComputePageLayoutOptions {
  readonly pageLayouts: readonly PageLayout[];
  readonly pageWidth: number;
  readonly zoom: number;
  readonly gap: number;
  readonly viewMode: ScoreViewMode;
  readonly pagesPerRow: number;
  readonly spreadFirstPage: ScoreSpreadFirstPage;
}

function computePageLayout({
  pageLayouts,
  pageWidth,
  zoom,
  gap,
  viewMode,
  pagesPerRow,
  spreadFirstPage,
}: ComputePageLayoutOptions): PageLayoutResult {
  const pageWidthPx = pageWidth * zoom;
  const pageHeights = pageLayouts.map((pageLayout) => pageLayout.height * zoom);
  const positions =
    viewMode === "horizon"
      ? pageLayouts.map((pageLayout, pageIndex) => ({
          page: pageIndex,
          x: 0,
          y: pageLayout.yOffset * zoom,
          width: pageWidthPx,
          height: pageLayout.height * zoom,
        }))
      : viewMode === "horizontal"
        ? computeHorizontalPositions(pageHeights, pageWidthPx, gap)
        : viewMode === "spread" || viewMode === "spread-horizontal"
          ? computeSpreadPositions(pageHeights, pageWidthPx, gap, spreadFirstPage, viewMode === "spread-horizontal")
          : computePagePositions(pageHeights, pageWidthPx, gap, pagesPerRow);

  return { positions, ...computeBounds(positions) };
}

function computeHorizontalPositions(
  pageHeights: readonly number[],
  pageWidth: number,
  gap: number,
): readonly ScorePagePosition[] {
  let currentX = 0;
  return pageHeights.map((pageHeight, pageIndex) => {
    const position = { page: pageIndex, x: currentX, y: 0, width: pageWidth, height: pageHeight };
    currentX += pageWidth + gap;
    return position;
  });
}

function computePagePositions(
  pageHeights: readonly number[],
  pageWidth: number,
  gap: number,
  pagesPerRow: number,
): readonly ScorePagePosition[] {
  const columns = Math.max(1, Math.floor(pagesPerRow));
  const rowHeights: number[] = [];
  for (let pageIndex = 0; pageIndex < pageHeights.length; pageIndex += 1) {
    const rowIndex = Math.floor(pageIndex / columns);
    rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? 0, pageHeights[pageIndex] ?? 0);
  }

  const rowOffsets: number[] = [];
  let currentY = 0;
  for (const rowHeight of rowHeights) {
    rowOffsets.push(currentY);
    currentY += rowHeight + gap;
  }

  return pageHeights.map((pageHeight, pageIndex) => {
    const rowIndex = Math.floor(pageIndex / columns);
    const columnIndex = pageIndex % columns;
    return {
      page: pageIndex,
      x: columnIndex * (pageWidth + gap),
      y: rowOffsets[rowIndex] ?? 0,
      width: pageWidth,
      height: pageHeight,
    };
  });
}

function computeSpreadPositions(
  pageHeights: readonly number[],
  pageWidth: number,
  gap: number,
  spreadFirstPage: ScoreSpreadFirstPage,
  horizontal: boolean,
): readonly ScorePagePosition[] {
  const positions: ScorePagePosition[] = [];
  const spreadWidth = pageWidth * 2 + gap;
  let pageIndex = 0;
  let currentX = 0;
  let currentY = 0;

  const placeSpread = (spreadPages: readonly number[]) => {
    const spreadHeight = Math.max(...spreadPages.map((sourcePageIndex) => pageHeights[sourcePageIndex] ?? 0));
    const singleOffset = spreadPages.length === 1 ? (spreadWidth - pageWidth) / 2 : 0;

    for (const [spreadPageIndex, sourcePageIndex] of spreadPages.entries()) {
      positions[sourcePageIndex] = {
        page: sourcePageIndex,
        x: currentX + singleOffset + spreadPageIndex * (pageWidth + gap),
        y: currentY,
        width: pageWidth,
        height: pageHeights[sourcePageIndex] ?? 0,
      };
    }

    if (horizontal) {
      currentX += spreadWidth + gap;
    } else {
      currentY += spreadHeight + gap;
    }
  };

  if (spreadFirstPage === "single" && pageHeights.length > 0) {
    placeSpread([0]);
    pageIndex = 1;
  }

  while (pageIndex < pageHeights.length) {
    const nextPageIndex = pageIndex + 1;
    placeSpread(nextPageIndex < pageHeights.length ? [pageIndex, nextPageIndex] : [pageIndex]);
    pageIndex += 2;
  }

  return positions;
}

function computeBounds(positions: readonly ScorePagePosition[]): { width: number; height: number } {
  if (positions.length === 0) return { width: 0, height: 0 };
  return positions.reduce(
    (bounds, position) => ({
      width: Math.max(bounds.width, position.x + position.width),
      height: Math.max(bounds.height, position.y + position.height),
    }),
    { width: 0, height: 0 },
  );
}

ScoreView.Page = ScorePage;
ScoreView.Playhead = ScorePlayhead;

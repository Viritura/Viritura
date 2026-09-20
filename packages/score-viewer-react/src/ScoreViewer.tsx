import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DisplayList, Engine, EngineLoadError, LayoutError, ParseError } from "@viritura/score-engine";
import { ScoreView, type ScorePageMargins, type ScoreSpreadFirstPage, type ScoreViewMode } from "./ScoreView";
import {
  ScoreViewerControls,
  type ScoreFitMode,
  type ScoreViewerControlOptions,
  type ScoreViewerPageSizeOption,
  type ScoreViewerScoreOption,
  type ScoreViewerStaffSizeOption,
  type ScoreViewerControlSurface,
} from "./ScoreViewerControls";
import { useNativeWheelZoom } from "./useNativeWheelZoom";
import { useViewerLayoutControls } from "./viewerLayoutControls";

export interface ScoreViewerProps {
  readonly mnx: string | object;
  readonly assetBaseUrl?: string;
  readonly pageWidth?: number;
  readonly pageHeight?: number;
  readonly pageMargins?: ScorePageMargins;
  readonly spatium?: number;
  readonly pageSizeOptions?: readonly ScoreViewerPageSizeOption[];
  readonly defaultPageSizeId?: string;
  readonly onPageSizeChange?: (pageSize: ScoreViewerPageSizeOption) => void;
  readonly staffSizeOptions?: readonly ScoreViewerStaffSizeOption[];
  readonly staffSize?: number;
  readonly defaultStaffSize?: number;
  readonly onStaffSizeChange?: (spatium: number) => void;
  readonly scoreIndex?: number;
  readonly defaultScoreIndex?: number;
  readonly onScoreIndexChange?: (scoreIndex: number) => void;
  readonly scoreOptions?: readonly ScoreViewerScoreOption[];
  readonly gap?: number;
  readonly spreadFirstPage?: ScoreSpreadFirstPage;
  readonly viewMode?: ScoreViewMode;
  readonly defaultViewMode?: ScoreViewMode;
  readonly onViewModeChange?: (viewMode: ScoreViewMode) => void;
  readonly availableViewModes?: readonly ScoreViewMode[];
  readonly zoom?: number;
  readonly defaultZoom?: number;
  readonly onZoomChange?: (zoom: number) => void;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly zoomStep?: number;
  readonly fitMode?: ScoreFitMode;
  readonly defaultFitMode?: ScoreFitMode;
  readonly onFitModeChange?: (fitMode: ScoreFitMode) => void;
  readonly controls?: boolean | ScoreViewerControlOptions;
  readonly controlSurface?: ScoreViewerControlSurface;
  readonly enableCtrlWheelZoom?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly viewportClassName?: string;
  readonly viewportStyle?: CSSProperties;
  readonly scoreClassName?: string;
  readonly scoreStyle?: CSSProperties;
  readonly pageClassName?: string;
  readonly pageStyle?: CSSProperties;
  readonly pageBackground?: string;
  readonly loadingFallback?: ReactNode;
  readonly errorFallback?: (err: Error) => ReactNode;
  readonly onReady?: (info: { engine: Engine; displayList: DisplayList }) => void;
  readonly onPaint?: (info: { engine: Engine; displayList: DisplayList }) => void;
  readonly onError?: (err: EngineLoadError | ParseError | LayoutError) => void;
  readonly children?: ReactNode;
}

interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

const defaultAvailableViewModes: readonly ScoreViewMode[] = [
  "page",
  "horizontal",
  "spread",
  "spread-horizontal",
  "horizon",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPrimaryPageHeight(displayList: DisplayList | null, pageHeight: number, paged: boolean): number {
  if (!paged) return displayList?.height ?? pageHeight;
  return displayList?.pages?.[0]?.height ?? displayList?.height ?? pageHeight;
}

function getFitContentWidth(viewMode: ScoreViewMode, pageWidth: number, gap: number): number {
  return viewMode === "spread" || viewMode === "spread-horizontal" ? pageWidth * 2 + gap : pageWidth;
}

function getViewportPadding(): number {
  return 48;
}

function computeFitZoom(args: {
  readonly fitMode: ScoreFitMode;
  readonly viewportSize: ViewportSize;
  readonly displayList: DisplayList | null;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly viewMode: ScoreViewMode;
  readonly gap: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}): number | null {
  const { fitMode, viewportSize, displayList, pageWidth, pageHeight, viewMode, gap, minZoom, maxZoom } = args;
  if (fitMode === "none" || viewportSize.width <= 0 || viewportSize.height <= 0) return null;
  const padding = getViewportPadding();
  const usableWidth = Math.max(1, viewportSize.width - padding);
  const usableHeight = Math.max(1, viewportSize.height - padding);
  const layoutWidth = displayList && displayList.width > 0 ? displayList.width : Math.max(1, pageWidth);
  const contentWidth = getFitContentWidth(viewMode, layoutWidth, gap);
  const primaryPageHeight = getPrimaryPageHeight(displayList, pageHeight, pageWidth > 0);
  const widthZoom = usableWidth / contentWidth;
  const pageZoom = Math.min(widthZoom, usableHeight / primaryPageHeight);
  return clamp(fitMode === "page" ? pageZoom : widthZoom, minZoom, maxZoom);
}

function updateUncontrolled<T>(controlledValue: T | undefined, nextValue: T, setter: (value: T) => void): void {
  if (controlledValue == null) setter(nextValue);
}

function clearFitForHorizon(args: {
  readonly nextViewMode: ScoreViewMode;
  readonly fitMode: ScoreFitMode;
  readonly controlledFitMode?: ScoreFitMode;
  readonly setUncontrolledFitMode: (fitMode: ScoreFitMode) => void;
  readonly onFitModeChange?: (fitMode: ScoreFitMode) => void;
}): void {
  const { nextViewMode, fitMode, controlledFitMode, setUncontrolledFitMode, onFitModeChange } = args;
  if (nextViewMode !== "horizon" || fitMode === "none") return;
  if (controlledFitMode == null) setUncontrolledFitMode("none");
  onFitModeChange?.("none");
}

// eslint-disable-next-line max-lines-per-function -- public component shell: declares props, score-index controlled/uncontrolled state, WASM init effect, scroll-into-view effect, score-selector dropdown, and JSX render. Sub-pieces are external (ScoreViewerInner, useEmbeddedAssets); the remaining shell is single-concept (controlled-vs-uncontrolled + render).
export function ScoreViewer({
  mnx,
  assetBaseUrl,
  pageWidth = 800,
  pageHeight = pageWidth * (297 / 210),
  pageMargins,
  spatium = 7,
  pageSizeOptions: providedPageSizeOptions,
  defaultPageSizeId,
  onPageSizeChange,
  staffSizeOptions: providedStaffSizeOptions,
  staffSize: controlledStaffSize,
  defaultStaffSize,
  onStaffSizeChange,
  scoreIndex: controlledScoreIndex,
  defaultScoreIndex = 0,
  onScoreIndexChange,
  scoreOptions = [],
  gap = 16,
  spreadFirstPage = "single",
  viewMode: controlledViewMode,
  defaultViewMode = "page",
  onViewModeChange,
  availableViewModes = defaultAvailableViewModes,
  zoom: controlledZoom,
  defaultZoom = 1,
  onZoomChange,
  minZoom = 0.25,
  maxZoom = 2,
  zoomStep = 0.05,
  fitMode: controlledFitMode,
  defaultFitMode = "none",
  onFitModeChange,
  controls = true,
  controlSurface = "floating-status",
  enableCtrlWheelZoom = true,
  className,
  style,
  viewportClassName,
  viewportStyle,
  scoreClassName,
  scoreStyle,
  pageClassName,
  pageStyle,
  pageBackground,
  loadingFallback,
  errorFallback,
  onReady,
  onPaint,
  onError,
  children,
}: ScoreViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [uncontrolledScoreIndex, setUncontrolledScoreIndex] = useState(defaultScoreIndex);
  const [uncontrolledViewMode, setUncontrolledViewMode] = useState(defaultViewMode);
  const [uncontrolledZoom, setUncontrolledZoom] = useState(defaultZoom);
  const [uncontrolledFitMode, setUncontrolledFitMode] = useState(defaultFitMode);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [displayList, setDisplayList] = useState<DisplayList | null>(null);

  const scoreIndex = controlledScoreIndex ?? uncontrolledScoreIndex;
  const viewMode = controlledViewMode ?? uncontrolledViewMode;
  const zoom = controlledZoom ?? uncontrolledZoom;
  const fitMode = controlledFitMode ?? uncontrolledFitMode;
  const {
    pageSizeId,
    staffSize,
    effectivePageWidth,
    effectivePageHeight,
    pageSizeOptions,
    staffSizeOptions,
    setPageSize,
    setSpatium,
  } = useViewerLayoutControls({
    pageWidth,
    pageHeight,
    spatium,
    pageSizeOptions: providedPageSizeOptions,
    staffSizeOptions: providedStaffSizeOptions,
    defaultPageSizeId,
    controlledStaffSize,
    defaultStaffSize,
    onPageSizeChange,
    onStaffSizeChange,
  });

  const setScoreIndex = useCallback(
    (nextScoreIndex: number) => {
      updateUncontrolled(controlledScoreIndex, nextScoreIndex, setUncontrolledScoreIndex);
      onScoreIndexChange?.(nextScoreIndex);
    },
    [controlledScoreIndex, onScoreIndexChange],
  );

  const setViewMode = useCallback(
    (nextViewMode: ScoreViewMode) => {
      updateUncontrolled(controlledViewMode, nextViewMode, setUncontrolledViewMode);
      clearFitForHorizon({
        nextViewMode,
        fitMode,
        controlledFitMode,
        setUncontrolledFitMode,
        onFitModeChange,
      });
      onViewModeChange?.(nextViewMode);
    },
    [controlledFitMode, controlledViewMode, fitMode, onFitModeChange, onViewModeChange],
  );

  const setFitMode = useCallback(
    (nextFitMode: ScoreFitMode) => {
      updateUncontrolled(controlledFitMode, nextFitMode, setUncontrolledFitMode);
      onFitModeChange?.(nextFitMode);
    },
    [controlledFitMode, onFitModeChange],
  );

  const setZoom = useCallback(
    (nextZoom: number, options: { readonly preserveFit?: boolean } = {}) => {
      const clampedZoom = clamp(nextZoom, minZoom, maxZoom);
      if (!options.preserveFit) {
        if (controlledFitMode == null) setUncontrolledFitMode("none");
        onFitModeChange?.("none");
      }
      if (controlledZoom == null) setUncontrolledZoom(clampedZoom);
      onZoomChange?.(clampedZoom);
    },
    [controlledFitMode, controlledZoom, maxZoom, minZoom, onFitModeChange, onZoomChange],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scoreOptions.length === 0) return;
    if (scoreOptions.some((option) => option.index === scoreIndex)) return;
    setScoreIndex(scoreOptions[0]?.index ?? 0);
  }, [scoreIndex, scoreOptions, setScoreIndex]);

  const fitZoom = useMemo(
    () =>
      computeFitZoom({
        fitMode,
        viewportSize,
        displayList,
        pageWidth: effectivePageWidth,
        pageHeight: effectivePageHeight,
        viewMode,
        gap,
        minZoom,
        maxZoom,
      }),
    [displayList, effectivePageHeight, effectivePageWidth, fitMode, gap, maxZoom, minZoom, viewMode, viewportSize],
  );

  useEffect(() => {
    if (fitZoom == null) return;
    if (Math.abs(fitZoom - zoom) < 0.001) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    if (controlledZoom == null) setUncontrolledZoom(fitZoom);
    onZoomChange?.(fitZoom);
  }, [controlledZoom, fitZoom, onZoomChange, zoom]);

  const handleReady = useCallback(
    (info: { engine: Engine; displayList: DisplayList }) => {
      setDisplayList(info.displayList);
      onReady?.(info);
    },
    [onReady],
  );

  useNativeWheelZoom({ viewerRef, enabled: enableCtrlWheelZoom, zoom, zoomStep, setZoom });

  const viewerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    background: "#eceef1",
    color: "#1d232f",
    ...style,
  };

  const viewportBaseStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "auto",
    padding: 24,
    boxSizing: "border-box",
    ...viewportStyle,
  };

  const scoreBaseStyle: CSSProperties = {
    margin: viewMode === "horizontal" || viewMode === "spread-horizontal" || viewMode === "horizon" ? "0" : "0 auto",
    ...scoreStyle,
  };

  return (
    <div ref={viewerRef} className={className} style={viewerStyle}>
      <div ref={viewportRef} className={viewportClassName} style={viewportBaseStyle}>
        <ScoreView
          mnx={mnx}
          assetBaseUrl={assetBaseUrl}
          pageWidth={effectivePageWidth}
          pageHeight={effectivePageHeight}
          pageMargins={pageMargins}
          spatium={staffSize}
          scoreIndex={scoreIndex}
          viewMode={viewMode}
          zoom={zoom}
          gap={gap}
          spreadFirstPage={spreadFirstPage}
          pageClassName={pageClassName}
          pageStyle={pageStyle}
          pageBackground={pageBackground}
          className={scoreClassName}
          style={scoreBaseStyle}
          loadingFallback={loadingFallback}
          errorFallback={errorFallback}
          onReady={handleReady}
          onPaint={onPaint}
          onError={onError}
        >
          {children}
        </ScoreView>
      </div>

      <ScoreViewerControls
        scoreIndex={scoreIndex}
        onScoreIndexChange={setScoreIndex}
        scoreOptions={scoreOptions}
        pageSizeId={pageSizeId}
        onPageSizeChange={setPageSize}
        pageSizeOptions={pageSizeOptions}
        staffSize={staffSize}
        onStaffSizeChange={setSpatium}
        staffSizeOptions={staffSizeOptions}
        showLayoutSettings={viewMode !== "horizon"}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        availableViewModes={availableViewModes}
        zoom={zoom}
        onZoomChange={setZoom}
        fitMode={fitMode}
        onFitModeChange={setFitMode}
        controls={controls}
        surface={controlSurface}
        minZoom={minZoom}
        maxZoom={maxZoom}
        zoomStep={zoomStep}
      />
    </div>
  );
}

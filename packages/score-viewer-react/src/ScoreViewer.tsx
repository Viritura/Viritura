import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
} from "react";
import type { DisplayList, Engine, EngineLoadError, LayoutError, ParseError } from "@viritura/score-engine";
import { ScoreView, type ScorePageMargins, type ScoreSpreadFirstPage, type ScoreViewMode } from "./ScoreView";
import {
  ScoreViewerControls,
  type ScoreFitMode,
  type ScoreViewerControlOptions,
  type ScoreViewerScoreOption,
  type ScoreViewerControlSurface,
} from "./ScoreViewerControls";

export interface ScoreViewerProps {
  readonly mnx: string | object;
  readonly assetBaseUrl?: string;
  readonly pageWidth?: number;
  readonly pageHeight?: number;
  readonly pageMargins?: ScorePageMargins;
  readonly spatium?: number;
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

const defaultAvailableViewModes: readonly ScoreViewMode[] = ["page", "horizontal", "spread", "spread-horizontal"];

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

// eslint-disable-next-line max-lines-per-function -- public component shell: declares props, score-index controlled/uncontrolled state, WASM init effect, scroll-into-view effect, score-selector dropdown, and JSX render. Sub-pieces are external (ScoreViewerInner, useEmbeddedAssets); the remaining shell is single-concept (controlled-vs-uncontrolled + render).
export function ScoreViewer({
  mnx,
  assetBaseUrl,
  pageWidth = 800,
  pageHeight = pageWidth * (297 / 210),
  pageMargins,
  spatium = 7,
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

  const setScoreIndex = useCallback(
    (nextScoreIndex: number) => {
      if (controlledScoreIndex == null) setUncontrolledScoreIndex(nextScoreIndex);
      onScoreIndexChange?.(nextScoreIndex);
    },
    [controlledScoreIndex, onScoreIndexChange],
  );

  const setViewMode = useCallback(
    (nextViewMode: ScoreViewMode) => {
      if (controlledViewMode == null) setUncontrolledViewMode(nextViewMode);
      onViewModeChange?.(nextViewMode);
    },
    [controlledViewMode, onViewModeChange],
  );

  const setFitMode = useCallback(
    (nextFitMode: ScoreFitMode) => {
      if (controlledFitMode == null) setUncontrolledFitMode(nextFitMode);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    setScoreIndex(scoreOptions[0]?.index ?? 0);
  }, [scoreIndex, scoreOptions, setScoreIndex]);

  const fitZoom = useMemo(() => {
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
  }, [
    displayList,
    fitMode,
    gap,
    maxZoom,
    minZoom,
    pageHeight,
    pageWidth,
    viewMode,
    viewportSize.height,
    viewportSize.width,
  ]);

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

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!enableCtrlWheelZoom || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const factor = direction > 0 ? 1 + zoomStep : 1 - zoomStep;
      setZoom(zoom * factor);
    },
    [enableCtrlWheelZoom, setZoom, zoom, zoomStep],
  );

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
    margin: viewMode === "horizontal" || viewMode === "spread-horizontal" ? "0" : "0 auto",
    ...scoreStyle,
  };

  return (
    <div className={className} style={viewerStyle} onWheel={handleWheel}>
      <div ref={viewportRef} className={viewportClassName} style={viewportBaseStyle}>
        <ScoreView
          mnx={mnx}
          assetBaseUrl={assetBaseUrl}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          pageMargins={pageMargins}
          spatium={spatium}
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

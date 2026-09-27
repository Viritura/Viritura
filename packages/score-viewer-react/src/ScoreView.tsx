/* eslint-disable react-refresh/only-export-components -- ScoreView's Page and Playhead are component members of its public compound-component export */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { EngineLoadError, LayoutError, ParseError } from "@viritura/score-engine";
import { mountScore, type ScoreViewerHandle } from "@viritura/score-viewer";
import { ScoreViewContext, useScoreView } from "./scoreViewContext";
import { stylePageCanvases } from "./scoreViewCanvas";
import type { ScoreViewProps } from "./scoreViewProps";

interface ScorePageProps {
  page: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function ScorePage({ page, children, className, style }: ScorePageProps) {
  const { pagePositions } = useScoreView();
  const position = pagePositions[page];
  if (!position) return null;
  const pageStyle: CSSProperties = {
    position: "absolute",
    left: position.x,
    top: position.y,
    width: position.width,
    height: position.height,
    pointerEvents: "none",
    ...style,
  };
  return (
    <div className={className} data-page={page} style={pageStyle}>
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

const PLAYHEAD_BAR_STYLE: CSSProperties = { width: 2, height: "100%", background: "currentColor" };
const FALLBACK_STYLE: CSSProperties = { position: "absolute", top: 0, left: 0, padding: 16 };

function ScorePlayhead({ beat, position, partId, follow, render, className, style }: ScorePlayheadProps) {
  const { viewer, engine, displayList, pagePositions, zoom } = useScoreView();
  const request = position ? { ...position, partId } : beat == null ? null : { beat, partId };
  const geometry = engine && displayList && request ? engine.playhead(displayList, request) : null;
  const page = geometry && pagePositions[geometry.page];
  const left = geometry && page ? page.x + geometry.x * zoom : 0;
  const top = geometry && page ? page.y + geometry.y * zoom : 0;
  const height = geometry ? geometry.height * zoom : 0;
  useEffect(() => {
    if (!follow || !viewer || !geometry) return;
    const viewport = viewer.viewport;
    if (left < viewport.scrollLeft || left > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollTo({ left: Math.max(0, left - viewport.clientWidth / 3) });
    }
    if (top < viewport.scrollTop || top + height > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTo({ top: Math.max(0, top - viewport.clientHeight / 2) });
    }
  }, [follow, viewer, geometry, left, top, height]);
  if (!geometry || !page) return null;
  const markerStyle: CSSProperties = {
    position: "absolute",
    left,
    top,
    height,
    zIndex: 5,
    color: "#e34935",
    pointerEvents: "none",
    ...style,
  };
  return (
    <div className={className} data-score-playhead="true" style={markerStyle}>
      {render ? render({ x: geometry.x, y: geometry.y, height: geometry.height }) : <div style={PLAYHEAD_BAR_STYLE} />}
    </div>
  );
}

// eslint-disable-next-line complexity -- React shell maps optional presentation props and callbacks to one imperative viewer
function ScoreViewComponent({
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
  pageBackground,
  contentAlign,
  bare = false,
  ink,
  loadingFallback,
  errorFallback,
  children,
}: ScoreViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<ScoreViewerHandle | null>(null);
  const callbacks = useRef({ onReady, onPaint, onError, pageClassName, pageStyle });
  useEffect(() => {
    callbacks.current = { onReady, onPaint, onError, pageClassName, pageStyle };
    if (handle.current) stylePageCanvases(handle.current.surface, pageClassName, pageStyle);
  }, [onReady, onPaint, onError, pageClassName, pageStyle]);
  const firstMnxEffect = useRef(true);
  const [revision, setRevision] = useState(0);
  const [viewer, setViewer] = useState<ScoreViewerHandle | null>(null);
  const [status, setStatus] = useState<{ loading: boolean; error: Error | null }>({ loading: true, error: null });

  useEffect(() => {
    if (!container.current) return;
    const mounted = mountScore(container.current, mnx, {
      assetBaseUrl,
      pageWidth,
      pageHeight,
      pageMargins,
      spatium,
      scoreIndex,
      viewMode,
      zoom,
      pageGap: gap,
      spreadFirstPage,
      pagesPerRow,
      pageBackground,
      contentAlign,
      ink,
      onLoading() {
        setStatus({ loading: true, error: null });
      },
      onReady(info) {
        callbacks.current.onReady?.(info);
        setStatus({ loading: false, error: null });
        setRevision((value) => value + 1);
      },
      onLayout() {
        setRevision((value) => value + 1);
      },
      onPaint() {
        stylePageCanvases(mounted.surface, callbacks.current.pageClassName, callbacks.current.pageStyle);
        if (mounted.engine && mounted.displayList) {
          callbacks.current.onPaint?.({ engine: mounted.engine, displayList: mounted.displayList });
        }
      },
      onError(error) {
        setStatus({ loading: false, error });
        callbacks.current.onError?.(error as EngineLoadError | ParseError | LayoutError);
      },
    });
    handle.current = mounted;
    if (bare) mounted.viewport.style.padding = "0";
    setViewer(mounted);
    return () => {
      mounted.destroy();
      handle.current = null;
    };
    // Mount exactly once. Subsequent score/option changes use the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- imperative viewer lifecycle is owned by the mount
  }, []);

  useEffect(() => {
    if (firstMnxEffect.current) {
      firstMnxEffect.current = false;
      return;
    }
    handle.current?.update(mnx);
  }, [mnx]);
  useEffect(() => {
    const statusElement = viewer?.viewport.nextElementSibling;
    if (statusElement instanceof HTMLElement) {
      statusElement.toggleAttribute(
        "hidden",
        status.error ? Boolean(errorFallback) : !status.loading || loadingFallback != null,
      );
    }
  }, [viewer, status, loadingFallback, errorFallback]);
  useEffect(() => {
    handle.current?.setOptions({
      assetBaseUrl,
      pageWidth,
      pageHeight,
      pageMargins,
      spatium,
      scoreIndex,
      viewMode,
      zoom,
      pageGap: gap,
      spreadFirstPage,
      pagesPerRow,
      pageBackground,
      contentAlign,
      ink,
    });
  }, [
    assetBaseUrl,
    pageWidth,
    pageHeight,
    pageMargins?.top,
    pageMargins?.right,
    pageMargins?.bottom,
    pageMargins?.left,
    pageMargins,
    spatium,
    scoreIndex,
    viewMode,
    zoom,
    gap,
    spreadFirstPage,
    pagesPerRow,
    pageBackground,
    contentAlign,
    ink,
  ]);

  const context = {
    engine: viewer?.engine ?? null,
    displayList: viewer?.displayList ?? null,
    zoom: viewer?.zoom ?? (typeof zoom === "number" ? zoom : 1),
    pagePositions: viewer?.arrangement.positions ?? [],
    viewMode,
    viewer,
  };
  void revision;
  const rootStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: bare ? 0 : 480,
    ...style,
  };
  const fallback = status.error ? errorFallback?.(status.error) : status.loading ? loadingFallback : null;
  return (
    <ScoreViewContext.Provider value={context}>
      <div ref={container} className={className} style={rootStyle} />
      {viewer && children && createPortal(children, viewer.surface)}
      {viewer &&
        fallback &&
        viewer.viewport.parentElement &&
        createPortal(<div style={FALLBACK_STYLE}>{fallback}</div>, viewer.viewport.parentElement)}
    </ScoreViewContext.Provider>
  );
}

export const ScoreView = Object.assign(ScoreViewComponent, { Page: ScorePage, Playhead: ScorePlayhead });

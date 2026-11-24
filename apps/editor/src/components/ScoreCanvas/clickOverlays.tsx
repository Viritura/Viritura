import { useMemo, useRef, useEffect, useEffectEvent, useLayoutEffect, type RefObject } from "react";
import { paintCommand, paintInkCommands, splitCommandsByPage, type DisplayList } from "@viritura/renderer";
import { PlayheadOverlay } from "@viritura/playback";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import { useClickCanvasPlayback } from "../../store/clickCanvasStore";
import { computePagePlacements, PAGE_STACK_GAP } from "./viewportGeometry";
import { readerAdvance, readerGeometry } from "./readerAdvance";
import { clickFollowScroll, clickFrameClip } from "./clickViewport";
import { scorePageFrame } from "./imperativeHandle";

interface ClickCanvasOverlaysProps {
  readonly displayList: DisplayList | null;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
  readonly viewMode: ViewMode;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly setScroll: (x: number, y: number) => void;
  readonly safeArea?: { left?: number; top?: number; right?: number; bottom?: number };
}

interface AdvanceCanvasProps {
  readonly displayList: DisplayList;
  readonly sourcePage: number;
  readonly targetPage: number;
  readonly fraction: number;
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly viewMode: ViewMode;
}

function AdvanceCanvas({
  displayList,
  sourcePage,
  targetPage,
  fraction,
  zoom,
  scrollX,
  scrollY,
  viewMode,
}: AdvanceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const placements = useMemo(() => computePagePlacements(displayList, viewMode), [displayList, viewMode]);
  const source = placements[sourcePage];
  const target = placements[targetPage];
  const sourceHeight = displayList.pages?.[sourcePage]?.height ?? 0;
  const width = target?.width ?? 0;
  const height = sourceHeight * fraction;

  useEffect(() => {
    const canvas = canvasRef.current;
    const page = splitCommandsByPage(displayList)[sourcePage];
    if (!canvas || !source || !target || !page || width <= 0 || height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = width * zoom;
    const cssHeight = height * zoom;
    canvas.width = Math.ceil(cssWidth * ratio);
    canvas.height = Math.ceil(cssHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot create the reader advance canvas");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.setTransform(ratio * zoom, 0, 0, ratio * zoom, 0, -source.engineYOffset * ratio * zoom);
    paintInkCommands(context, page.commands, (command) => paintCommand(context, command));
  }, [displayList, sourcePage, source, target, width, height, zoom]);

  if (!source || !target || width <= 0 || height <= 0) return null;
  const style = {
    position: "absolute" as const,
    zIndex: 4,
    pointerEvents: "none" as const,
    background: "#fff",
    left: (target.x - scrollX) * zoom,
    top: (target.y - scrollY) * zoom,
    width: width * zoom,
    height: height * zoom,
  };
  return (
    <canvas
      ref={canvasRef}
      aria-label={`Advance preview of page ${sourcePage + 1}`}
      data-reader-source-page={sourcePage}
      data-reader-target-page={targetPage}
      style={style}
    />
  );
}

export function ClickCanvasOverlays({
  displayList,
  scrollX,
  scrollY,
  zoom,
  viewMode,
  containerRef,
  canvasRef,
  setScroll,
  safeArea,
}: ClickCanvasOverlaysProps) {
  const playback = useClickCanvasPlayback();
  const geometry = useMemo(() => (displayList ? readerGeometry(displayList) : null), [displayList]);
  const measure = geometry?.measures.find((candidate) => candidate.index === playback.position?.measureIndex);
  const followedMeasure = viewMode === "horizon" || !playback.active ? playback.position?.measureIndex : undefined;
  const horizonBeat = viewMode === "horizon" ? playback.position?.beat : undefined;
  const clipFrame = useEffectEvent(() => {
    const container = containerRef.current;
    const wrap = canvasRef.current?.parentElement;
    if (!container || !wrap) return;
    if (viewMode === "horizon") {
      wrap.style.removeProperty("clip-path");
      return;
    }
    const frame = displayList && measure ? scorePageFrame(displayList, viewMode, measure.page) : null;
    wrap.style.setProperty(
      "clip-path",
      clickFrameClip(frame, container.clientWidth, container.clientHeight, zoom, safeArea),
    );
  });
  const follow = useEffectEvent(() => {
    const container = containerRef.current;
    if (!container || !displayList || !playback.position) return;
    const next = clickFollowScroll({
      displayList,
      position: playback.position,
      page: measure?.page,
      viewMode,
      viewport: { scrollX, scrollY, zoom },
      width: container.clientWidth,
      height: container.clientHeight,
      safeArea,
    });
    if (next && (Math.abs(next.x - scrollX) > 0.01 || Math.abs(next.y - scrollY) > 0.01)) {
      setScroll(next.x, next.y);
    }
  });
  useLayoutEffect(() => {
    follow();
    clipFrame();
  }, [
    displayList,
    viewMode,
    measure?.page,
    followedMeasure,
    horizonBeat,
    zoom,
    safeArea?.left,
    safeArea?.top,
    safeArea?.right,
    safeArea?.bottom,
  ]);
  useEffect(() => {
    const container = containerRef.current;
    const wrap = canvasRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      follow();
      clipFrame();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      wrap?.style.removeProperty("clip-path");
    };
  }, [containerRef, canvasRef]);
  const advance = useMemo(() => {
    if (!playback.active || !playback.position || !displayList?.pages || !geometry || !measure) return undefined;
    return readerAdvance(
      viewMode,
      { page: measure.page, systemIndex: measure.systemIndex },
      playback.position.measureIndex,
      geometry.measures,
      geometry.systems,
      displayList.pages.map((page) => page.height),
    );
  }, [playback.active, playback.position, displayList, geometry, measure, viewMode]);

  return (
    <>
      <PlayheadOverlay
        playheadPosition={playback.position}
        displayList={displayList}
        scrollX={scrollX}
        scrollY={scrollY}
        zoom={zoom}
        viewMode={viewMode}
        pageOffsetY={viewMode === "page" ? (measure?.page ?? 0) * PAGE_STACK_GAP : 0}
        animate={playback.active}
      />
      {advance && displayList && (
        <AdvanceCanvas
          displayList={displayList}
          sourcePage={advance.sourcePage}
          targetPage={advance.targetPage}
          fraction={advance.fraction}
          zoom={zoom}
          scrollX={scrollX}
          scrollY={scrollY}
          viewMode={viewMode}
        />
      )}
    </>
  );
}

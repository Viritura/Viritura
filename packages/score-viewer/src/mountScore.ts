import {
  loadEngine,
  type DisplayList,
  type Engine,
  type LayoutWorker,
  type ScoreMeasurements,
} from "@viritura/score-engine";
import { arrangePages, contentOffset } from "./pageArrangement";
import { followOffset } from "./playheadFollow";
import { needsArrangement, needsLayout } from "./presentationChanges";
import type { ScoreArrangement, ScoreViewerHandle, ScoreViewerOptions } from "./types";
import { fitZoom } from "./zoom";

const emptyArrangement: ScoreArrangement = { positions: [], width: 0, height: 0 };
/** Viewport padding around the score surface, in CSS pixels. */
const VIEWPORT_PADDING = 24;

function pixel(value: number): string {
  return `${value}px`;
}

/**
 * Mount an independent score viewport. All owned DOM, observers, frames and
 * workers are released by `destroy()`. The host owns the element and its size.
 */
// eslint-disable-next-line max-lines-per-function, max-statements -- the mount owns one cohesive DOM/observer/layout lifecycle and its closures must share cancellation state
export function mountScore(
  element: HTMLElement,
  initialMnx: string | object | null,
  initialOptions: ScoreViewerOptions = {},
): ScoreViewerHandle {
  let options = { ...initialOptions };
  let mnx = initialMnx;
  let engine: Engine | null = options.engine ?? null;
  let displayList: DisplayList | null = null;
  let measurements: ScoreMeasurements | null = null;
  let arrangement = emptyArrangement;
  let zoom = typeof options.zoom === "number" ? options.zoom : 1;
  let worker: LayoutWorker | null = null;
  let destroyed = false;
  let generation = 0;
  let frame = 0;
  let pixelRatio = 0;
  let surfaceOffsetX = 0;
  let surfaceOffsetY = 0;
  let paintedPages = new Set<number>();
  const viewport = document.createElement("div");
  const surface = document.createElement("div");
  const pages = document.createElement("div");
  const paperSheet = document.createElement("div");
  const cursor = document.createElement("div");
  const status = document.createElement("div");
  const horizonCanvas = document.createElement("canvas");
  const pageElements = new Map<number, HTMLCanvasElement>();
  viewport.style.cssText = "position:relative;width:100%;height:100%;box-sizing:border-box;overflow:auto;";
  viewport.style.padding = pixel(VIEWPORT_PADDING);
  viewport.style.background = options.background ?? "";
  surface.style.cssText = "position:relative;";
  pages.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  paperSheet.style.cssText = "position:absolute;pointer-events:none;";
  cursor.style.cssText = "position:absolute;width:2px;background:#e34935;pointer-events:none;z-index:5;";
  status.style.cssText = "padding:16px;color:#666;";
  horizonCanvas.style.cssText = "position:absolute;pointer-events:none;";
  surface.append(paperSheet, pages, horizonCanvas, cursor);
  viewport.append(surface);
  element.replaceChildren(viewport, status);
  let tileRenderer: ReturnType<Engine["createTileRenderer"]> | null = null;

  function error(reason: unknown): void {
    if (destroyed) return;
    const exception = reason instanceof Error ? reason : new Error(String(reason));
    status.textContent = `Score error: ${exception.message}`;
    status.style.color = "#b00";
    status.hidden = false;
    viewport.hidden = true;
    options.onError?.(exception);
  }

  function layoutOptions() {
    const pageWidth = options.viewMode === "horizon" ? 0 : (options.pageWidth ?? 800);
    const defaultMargin = pageWidth * (15 / 210);
    const margins = options.pageMargins ?? {
      top: defaultMargin,
      right: defaultMargin,
      bottom: defaultMargin,
      left: defaultMargin,
    };
    return {
      pageWidth,
      spatium: options.spatium ?? 7,
      scoreIndex: options.scoreIndex ?? 0,
      pageSetup:
        pageWidth > 0 ? { height: options.pageHeight ?? pageWidth * (297 / 210), margins: { ...margins } } : undefined,
    };
  }

  // Consumers may override the inline padding (for example a bare embed).
  function viewportPadding(): number {
    return Number.parseFloat(viewport.style.paddingLeft) || 0;
  }

  function schedule(): void {
    if (!frame && !destroyed) frame = requestAnimationFrame(paintFrame);
  }

  /** Size the surface and offset it for `contentAlign`. `horizonHeight` is null outside horizon mode. */
  function placeSurface(horizonHeight: number | null): void {
    const centered = options.contentAlign === "center";
    const inner = {
      width: Math.max(0, viewport.clientWidth - 2 * viewportPadding()),
      height: Math.max(0, viewport.clientHeight - 2 * viewportPadding()),
    };
    const contentHeight = horizonHeight ?? arrangement.height;
    const offset = contentOffset(options.contentAlign, inner, { width: arrangement.width, height: contentHeight });
    surfaceOffsetX = offset.x;
    surfaceOffsetY = offset.y;
    surface.style.width = pixel(arrangement.width);
    surface.style.height = pixel(
      horizonHeight != null && !centered ? Math.max(contentHeight, inner.height) : contentHeight,
    );
    const flush =
      horizonHeight != null || options.viewMode === "horizontal" || options.viewMode === "spread-horizontal";
    surface.style.margin = centered ? `${pixel(offset.y)} 0 0 ${pixel(offset.x)}` : flush ? "0" : "0 auto";
  }

  function arrange(): void {
    if (!engine || !displayList || !measurements) return;
    const requestedZoom = options.zoom ?? 1;
    zoom =
      typeof requestedZoom === "number"
        ? requestedZoom
        : fitZoom(
            requestedZoom,
            { width: viewport.clientWidth, height: viewport.clientHeight },
            measurements.pages[0] ?? { width: displayList.width, height: displayList.height },
            options.viewMode ?? "page",
            options.pageGap ?? 16,
          );
    zoom = Math.max(0.01, zoom);
    arrangement = arrangePages({
      pages: measurements.pages,
      zoom,
      gap: options.pageGap ?? 16,
      viewMode: options.viewMode ?? "page",
      pagesPerRow: options.pagesPerRow,
      spreadFirstPage: options.spreadFirstPage,
    });
    const horizon = options.viewMode === "horizon";
    const paper = horizon ? engine.horizonPaper(displayList) : null;
    placeSurface(horizon ? (paper?.contentHeight ?? 0) * zoom : null);
    paperSheet.hidden = !paper;
    if (paper) {
      paperSheet.style.left = pixel(paper.x * zoom);
      paperSheet.style.top = pixel(paper.y * zoom);
      paperSheet.style.width = pixel(paper.width * zoom);
      paperSheet.style.height = pixel(paper.height * zoom);
      paperSheet.style.background = options.pageBackground ?? "#fff";
      paperSheet.style.boxShadow = options.pageBackground === "transparent" ? "none" : "0 2px 14px rgba(0,0,0,.24)";
    }
    horizonCanvas.hidden = !horizon;
    cursor.hidden = !options.playhead;
    if (horizon) {
      pages.replaceChildren();
      pageElements.clear();
      tileRenderer ??= engine.createTileRenderer();
      tileRenderer.invalidate();
    } else {
      horizonCanvas.width = 0;
      horizonCanvas.height = 0;
      pages.replaceChildren();
      pageElements.clear();
    }
    paintedPages = new Set();
    options.onLayout?.(measurements, arrangement);
    positionCursor();
    schedule();
  }

  function positionCursor(): void {
    if (!engine || !displayList || !options.playhead) {
      cursor.hidden = true;
      return;
    }
    const geometry = engine.playhead(displayList, options.playhead);
    const page = geometry && arrangement.positions[geometry.page];
    if (!geometry || !page) {
      cursor.hidden = true;
      return;
    }
    cursor.hidden = false;
    const x = page.x + geometry.x * zoom;
    const y = page.y + geometry.y * zoom;
    cursor.style.left = pixel(x);
    cursor.style.top = pixel(y);
    cursor.style.height = pixel(geometry.height * zoom);
    if (options.playhead.follow) {
      viewport.scrollLeft = followOffset(x, 2, viewport.scrollLeft, viewport.clientWidth, 1 / 3);
      viewport.scrollTop = followOffset(y, geometry.height * zoom, viewport.scrollTop, viewport.clientHeight, 1 / 2);
    }
  }

  // eslint-disable-next-line complexity, max-statements -- visible-page virtualization and horizon tile paint share a single scheduled frame
  function paintFrame(): void {
    frame = 0;
    if (!engine || !displayList || !measurements || destroyed) return;
    const dpr = window.devicePixelRatio || 1;
    if (pixelRatio !== dpr) {
      pixelRatio = dpr;
      paintedPages.clear();
      tileRenderer?.invalidate();
    }
    if (options.viewMode === "horizon") {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const canvasWidth = Math.ceil(width * dpr);
      const canvasHeight = Math.ceil(height * dpr);
      if (horizonCanvas.width !== canvasWidth) horizonCanvas.width = canvasWidth;
      if (horizonCanvas.height !== canvasHeight) horizonCanvas.height = canvasHeight;
      horizonCanvas.style.width = pixel(width);
      horizonCanvas.style.height = pixel(height);
      // Cover exactly the visible viewport, expressed in surface coordinates,
      // so the canvas never extends the scrollable area.
      const left = viewport.scrollLeft - viewportPadding() - surfaceOffsetX;
      const top = viewport.scrollTop - viewportPadding() - surfaceOffsetY;
      horizonCanvas.style.left = pixel(left);
      horizonCanvas.style.top = pixel(top);
      const pending = tileRenderer?.paint(horizonCanvas, displayList, {
        scrollX: left / zoom,
        scrollY: top / zoom,
        zoom,
        ink: options.ink,
      });
      if (pending) schedule();
      else options.onPaint?.();
      return;
    }
    const minX = viewport.scrollLeft - 100;
    const maxX = viewport.scrollLeft + viewport.clientWidth + 100;
    const minY = viewport.scrollTop - 100;
    const maxY = viewport.scrollTop + viewport.clientHeight + 100;
    for (const page of arrangement.positions) {
      const visible = page.x + page.width >= minX && page.x <= maxX && page.y + page.height >= minY && page.y <= maxY;
      let canvas = pageElements.get(page.page);
      if (!visible) {
        canvas?.remove();
        pageElements.delete(page.page);
        paintedPages.delete(page.page);
        continue;
      }
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.dataset.page = String(page.page);
        canvas.style.position = "absolute";
        canvas.style.boxShadow = options.pageBackground === "transparent" ? "none" : "0 2px 14px rgba(0,0,0,.24)";
        pages.append(canvas);
        pageElements.set(page.page, canvas);
      }
      canvas.style.left = pixel(page.x);
      canvas.style.top = pixel(page.y);
      canvas.style.width = pixel(page.width);
      canvas.style.height = pixel(page.height);
      const width = Math.ceil(page.width * dpr);
      const height = Math.ceil(page.height * dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (paintedPages.has(page.page)) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
      if (options.pageBackground !== "transparent") {
        ctx.fillStyle = options.pageBackground ?? "#fff";
        ctx.fillRect(0, 0, page.width / zoom, page.height / zoom);
      }
      engine.paint(ctx, displayList, { page: page.page, ink: options.ink });
      paintedPages.add(page.page);
    }
    options.onPaint?.();
  }

  async function layout(): Promise<void> {
    const current = ++generation;
    if (mnx == null) {
      displayList = null;
      measurements = null;
      arrangement = emptyArrangement;
      pages.replaceChildren();
      pageElements.clear();
      paintedPages.clear();
      cursor.hidden = true;
      horizonCanvas.width = 0;
      horizonCanvas.height = 0;
      surface.style.width = "0";
      surface.style.height = "0";
      status.hidden = true;
      viewport.hidden = true;
      return;
    }
    status.textContent = "Loading score";
    status.style.color = "#666";
    status.hidden = false;
    viewport.hidden = true;
    options.onLoading?.();
    try {
      const loaded = engine ?? (await loadEngine({ assetBaseUrl: options.assetBaseUrl, textFont: options.textFont }));
      if (destroyed || current !== generation) return;
      engine = loaded;
      if (options.useWorker && !worker) worker = loaded.createLayoutWorker();
      if (!options.useWorker && worker) {
        worker.dispose();
        worker = null;
      }
      const list = worker ? await worker.layout(mnx, layoutOptions()) : loaded.layout(mnx, layoutOptions());
      if (destroyed || current !== generation) return;
      displayList = list;
      measurements = loaded.measure(list);
      status.hidden = true;
      viewport.hidden = false;
      arrange();
      options.onReady?.({ engine: loaded, displayList: list });
    } catch (reason) {
      if (current === generation) error(reason);
    }
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (displayList) arrange();
        })
      : null;
  resizeObserver?.observe(viewport);
  const onScroll = () => schedule();
  viewport.addEventListener("scroll", onScroll, { passive: true });
  const onWindowResize = () => schedule();
  window.addEventListener("resize", onWindowResize);
  let ratioQuery: MediaQueryList | null = null;
  const onRatioChange = () => {
    ratioQuery?.removeEventListener("change", onRatioChange);
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    ratioQuery.addEventListener("change", onRatioChange);
    schedule();
  };
  if (typeof window.matchMedia === "function") onRatioChange();
  void layout();

  return {
    get engine() {
      return engine;
    },
    get displayList() {
      return displayList;
    },
    get measurements() {
      return measurements;
    },
    get arrangement() {
      return arrangement;
    },
    get zoom() {
      return zoom;
    },
    viewport,
    surface,
    update(next) {
      mnx = next;
      void layout();
    },
    setOptions(next) {
      const previous = options;
      options = { ...options, ...next };
      if (next.engine && next.engine !== engine) {
        worker?.dispose();
        worker = null;
        engine = next.engine;
      }
      if (needsLayout(previous, options)) {
        void layout();
        return;
      }
      if (displayList && measurements) {
        if (needsArrangement(previous, options)) arrange();
        positionCursor();
      }
      viewport.style.background = options.background ?? "";
    },
    zoomTo(next) {
      options = { ...options, zoom: next };
      arrange();
    },
    scrollToPosition(position) {
      if (!engine || !displayList) return;
      const point = engine.positionToCanvas(displayList, position);
      const page = point && arrangement.positions[point.page];
      if (!point || !page) return;
      viewport.scrollLeft = Math.max(0, page.x + point.x * zoom - viewport.clientWidth / 3);
      viewport.scrollTop = Math.max(0, page.y + point.y * zoom - viewport.clientHeight / 2);
    },
    playheadGeometry() {
      return engine && displayList && options.playhead ? engine.playhead(displayList, options.playhead) : null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      cancelAnimationFrame(frame);
      worker?.dispose();
      resizeObserver?.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onWindowResize);
      ratioQuery?.removeEventListener("change", onRatioChange);
      viewport.remove();
      status.remove();
    },
  };
}

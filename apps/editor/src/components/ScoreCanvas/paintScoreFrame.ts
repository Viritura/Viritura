import {
  paintSelectionOverlay,
  paintMeasureSelectionOverlay,
  paintHitboxDebug,
  paintSpannerDragPreview,
  isTileCacheDisabled,
  TileCache,
  PerfTracker,
  GlyphAtlas,
  SpatialIndex,
  detectStaves,
  detectHorizonStaves,
  extractStickyClefInfo,
  paintStickyClefs,
  paintMeasureNumber,
  DEFAULT_TILE_SIZE,
  type DisplayList,
  type StickyClefInfo,
  type SpannerHandleHit,
  type SlurGeometry,
  type RenderCommand,
} from "@viritura/renderer";
import type { PageSetup } from "@viritura/core";

import { PAGE_STACK_GAP, computePagePlacements, placementCommandOffset, drawMarginGuides } from "./viewportGeometry";
import { getPaperPattern, PAPER_CREAM_FALLBACK } from "./paperPattern";
import { repaintCanvas } from "./repaintCanvas";
import { paintEngraveAdornments, paintWriteSlurHandles } from "./paintEngraveAdornments";
import { useLayoutDebugStore } from "../../debug/layoutDebugStore";
import { paintLayoutDebug } from "../../debug/layoutDebugPainter";
import type { SelectionState } from "../../store/selectionStore";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import type { BarlineHit, EngraveAdornments } from "./ScoreCanvas";

/** Pixels per millimetre — canonical rendering density for the layout canvas. */
const PX_PER_MM = 12;

interface ViewportInfo {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

interface StickyClefCache {
  version: number;
  info: StickyClefInfo[];
  staves: ReturnType<typeof detectStaves>;
}

export interface SpannerDragState {
  hit: SpannerHandleHit;
  dragX: number;
  bbox: { x: number; y: number; width: number; height: number };
  snapPoints: Array<{ x: number; beat: number; measureIndex: number }>;
  altKey: boolean;
}

export interface SlurHandleDragState {
  elementId: string;
  handle: "p0" | "p1" | "p2" | "p3" | "pm";
  startEngineX: number;
  startEngineY: number;
  dxPx: number;
  dyPx: number;
  sp: number;
  geom: SlurGeometry;
  sourceCommand: Extract<RenderCommand, { type: "DrawFilledBezier" }>;
  /** Present only for `p0`/`p3` drags, which re-anchor the slur onto a
   *  different event rather than nudging the drawn curve. Drives the snap
   *  ruler and the commit. */
  anchor?: {
    end: "start" | "end";
    /** Candidate note onsets in the slur's part. */
    points: Array<{ x: number; y: number; eventId: string; measureIndex: number }>;
    /** Live cursor position in engine space. */
    dragX: number;
    dragY: number;
  };
}

/** Live drag of a text expression in engrave mode. The paint loop occludes the
 *  element's original ink and redraws its actual `DrawText` commands translated
 *  by the in-progress drag, so the real text follows the cursor before the move
 *  commits (mirrors the slur handle drag preview). */
export interface TextExpressionDragState {
  elementId: string;
  /** Engine-space bbox of the element at drag start (used to occlude the original). */
  bbox: { x: number; y: number; width: number; height: number };
  /** The element's render commands captured at drag start, redrawn translated. */
  commands: import("@viritura/renderer").RenderCommand[];
  /** Px deltas in engine space (zoom-adjusted on the input side). */
  dxPx: number;
  dyPx: number;
}

/**
 * Paint the drag preview + snap ruler, marking the tick nearest the cursor as
 * active. Shared by spanner handle drags (beat snaps) and slur endpoint drags
 * (note-onset snaps) so both give the same "where will this land" feedback.
 */
function paintSnapRuler(
  ctx: CanvasRenderingContext2D,
  bbox: { x: number; y: number; width: number; height: number },
  handle: "start" | "end",
  dragX: number,
  points: ReadonlyArray<{ x: number; y?: number; beat?: number; measureIndex: number }>,
  dragY?: number,
): void {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const dist =
      dragY === undefined || point.y === undefined
        ? Math.abs(dragX - point.x)
        : Math.hypot(dragX - point.x, dragY - point.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  // Slur anchors have no beat position; weight them uniformly as whole beats.
  const ticks = points.map((p, i) => ({
    x: p.x,
    beat: p.beat ?? 1,
    measureIndex: p.measureIndex,
    active: i === bestIdx,
  }));
  paintSpannerDragPreview(ctx, bbox, handle, dragX, ticks);
}

export interface PaintScoreFrameArgs {
  canvas: HTMLCanvasElement;
  container: HTMLElement | null;
  displayList: DisplayList;
  forceDirect: boolean;
  viewport: ViewportInfo;
  /** Read+mutated: previous zoom; we update it inside this call. */
  prevZoomRef: { current: number };
  selectedIds: Set<string> | null;
  selectionVoiceIndex?: number;
  selection: SelectionState;
  viewMode: ViewMode;
  printPreview: boolean;
  safeAreaLeft: number;
  hitboxOverlayEnabled: boolean;
  performanceOverlayEnabled: boolean;
  interactionMode: "write" | "engrave";
  perfTracker: PerfTracker;
  tileCache: TileCache;
  glyphAtlas: GlyphAtlas | null;
  spatialIndex: SpatialIndex | null;
  displayListVersion: number;
  pageSetup: PageSetup;
  engraveBarlineHover: BarlineHit | null;
  engraveAdornments: EngraveAdornments | undefined;
  selectedEngraveMarkerId: string | null;
  partIdByIndex: readonly string[];
  engraveEyeHoverId: string | null;
  engraveGhostRailHoverId: string | null;
  engraveHoverFadeT: number;
  slurHandleDrag: SlurHandleDragState | null;
  hoverSlurHandleKey: string | null;
  selectedSlurId: string | null;
  textExpressionDrag: TextExpressionDragState | null;
  spannerDrag: SpannerDragState | null;
  /** Mutated in place when the display-list version changes. */
  stickyClefCache: StickyClefCache;
}

// eslint-disable-next-line max-lines-per-function, complexity, max-statements -- single cohesive paint pipeline; sub-pieces are already extracted helpers
export function paintScoreFrame(args: PaintScoreFrameArgs): void {
  performance.mark("viritura:paint-frame-entry");
  try {
    performance.measure("viritura:paint-dispatch", "viritura:raf-callback", "viritura:paint-frame-entry");
    performance.measure("viritura:paint-args", "viritura:paint-callback-ready", "viritura:paint-frame-entry");
  } catch {
    /* optional performance telemetry */
  }
  const {
    canvas,
    container,
    displayList: dl,
    forceDirect,
    viewport,
    prevZoomRef,
    selectedIds,
    selection,
    viewMode,
    printPreview,
    safeAreaLeft,
    hitboxOverlayEnabled,
    performanceOverlayEnabled,
    interactionMode,
    perfTracker,
    tileCache,
    glyphAtlas,
    spatialIndex,
    displayListVersion,
    pageSetup,
    engraveBarlineHover,
    engraveAdornments,
    selectedEngraveMarkerId,
    partIdByIndex,
    engraveEyeHoverId,
    engraveGhostRailHoverId,
    engraveHoverFadeT,
    slurHandleDrag,
    hoverSlurHandleKey,
    selectedSlurId,
    textExpressionDrag,
    spannerDrag,
    stickyClefCache,
  } = args;

  // Size canvas to fill the container
  const dpr = window.devicePixelRatio || 1;
  const vw = container?.clientWidth ?? dl.width;
  const vh = container ? container.clientHeight : Math.max(dl.height * viewport.zoom, 400);

  performance.mark("viritura:canvas-size-start");
  canvas.width = vw * dpr;
  canvas.height = vh * dpr;
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;
  performance.mark("viritura:canvas-size-end");
  try {
    performance.measure("viritura:canvas-size", "viritura:canvas-size-start", "viritura:canvas-size-end");
  } catch {
    /* optional performance telemetry */
  }

  const endFrame = perfTracker.beginFrame();

  const ctx = canvas.getContext("2d");
  performance.mark("viritura:paint-setup-end");
  try {
    performance.measure("viritura:paint-setup", "viritura:paint-frame-entry", "viritura:paint-setup-end");
  } catch {
    /* optional performance telemetry */
  }

  // Detect active zoom gesture: use direct render to avoid expensive
  // tile invalidation + re-render on every wheel tick.
  const zoomChanged = viewport.zoom !== prevZoomRef.current;
  prevZoomRef.current = viewport.zoom;

  let usedTileCache = false;
  performance.mark("viritura:base-score-paint-start");
  const suppressedSlurId = slurHandleDrag?.elementId;
  const baseSelectedIds =
    suppressedSlurId && selectedIds?.has(suppressedSlurId)
      ? new Set([...selectedIds].filter((id) => id !== suppressedSlurId))
      : selectedIds;
  if (
    forceDirect ||
    suppressedSlurId ||
    zoomChanged ||
    isTileCacheDisabled() ||
    viewMode === "spread" ||
    viewMode === "spread-h"
  ) {
    repaintCanvas({
      canvas,
      displayList: dl,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: viewport.zoom,
      glyphAtlas,
      spatialIndex,
      selectedIds: baseSelectedIds ?? undefined,
      selectionVoiceIndex: args.selectionVoiceIndex,
      dragPreview: null,
      viewMode,
      measureSelection:
        selection.kind === "measure"
          ? {
              startMeasure: selection.startMeasure,
              endMeasure: selection.endMeasure,
              startPart: selection.startStaffIndex,
              endPart: selection.endStaffIndex,
            }
          : null,
      suppressedElementId: suppressedSlurId,
      printableInsets: {
        top: pageSetup.margins.top * PX_PER_MM,
        right: pageSetup.margins.right * PX_PER_MM,
        bottom: pageSetup.margins.bottom * PX_PER_MM,
        left: pageSetup.margins.left * PX_PER_MM,
      },
    });
  } else {
    usedTileCache = true;
    const canvasBg = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() || "#e0e2ea";
    const tileCtx = canvas.getContext("2d");
    const paper = tileCtx ? getPaperPattern(tileCtx) : { pattern: null, cream: PAPER_CREAM_FALLBACK, ready: null };
    const paperFill: string | CanvasPattern = paper.pattern ?? paper.cream;
    if (paper.ready) {
      paper.ready.then(() => {
        window.dispatchEvent(new CustomEvent("viritura:paper-ready"));
      });
    }
    tileCache.paintFrame({
      canvas,
      displayList: dl,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: viewport.zoom,
      version: displayListVersion,
      glyphAtlas,
      viewMode,
      canvasBg,
      paperFill,
      pageStackGap: viewMode === "page" ? PAGE_STACK_GAP : 0,
      printableInsets: {
        top: pageSetup.margins.top * PX_PER_MM,
        right: pageSetup.margins.right * PX_PER_MM,
        bottom: pageSetup.margins.bottom * PX_PER_MM,
        left: pageSetup.margins.left * PX_PER_MM,
      },
    });
  }
  performance.mark("viritura:base-score-paint-end");
  try {
    performance.measure(
      "viritura:base-score-paint",
      "viritura:base-score-paint-start",
      "viritura:base-score-paint-end",
    );
  } catch {
    /* optional performance telemetry */
  }
  performance.mark("viritura:post-score-paint-start");

  if (ctx) {
    const paper = getPaperPattern(ctx);
    const paperFill: string | CanvasPattern = paper.pattern ?? paper.cream;
    if (paper.ready) {
      paper.ready.then(() => {
        window.dispatchEvent(new CustomEvent("viritura:paper-ready"));
      });
    }

    ctx.setTransform(
      dpr * viewport.zoom,
      0,
      0,
      dpr * viewport.zoom,
      -viewport.scrollX * dpr * viewport.zoom,
      -viewport.scrollY * dpr * viewport.zoom,
    );

    // Margin guides
    if (!printPreview && (viewMode === "page" || viewMode === "spread" || viewMode === "spread-h") && dl.pages) {
      const mPxOverlay = {
        top: pageSetup.margins.top * PX_PER_MM,
        right: pageSetup.margins.right * PX_PER_MM,
        bottom: pageSetup.margins.bottom * PX_PER_MM,
        left: pageSetup.margins.left * PX_PER_MM,
      };
      const PAGE_W = dl.width;

      // Page positions come from the shared single-source placement geometry
      // (see computePagePlacements), so margin guides stay in lockstep with
      // the painted pages across every view mode.
      const placements = computePagePlacements(dl, viewMode);
      for (let i = 0; i < dl.pages.length; i++) {
        const page = dl.pages[i];
        const pos = placements[i];
        if (!page || !pos) continue;
        drawMarginGuides(
          ctx,
          pos.x,
          pos.y,
          PAGE_W,
          page.height,
          mPxOverlay.top,
          mPxOverlay.right,
          mPxOverlay.bottom,
          mPxOverlay.left,
        );
      }
    }

    const pageMultiStacked = viewMode === "page" && dl.pages && dl.pages.length > 1 && PAGE_STACK_GAP > 0;
    const paintEngineOverlays = (): void => {
      if (usedTileCache && !printPreview && spatialIndex && selectedIds && selectedIds.size > 0) {
        if (selection.kind === "measure" && dl.measureBounds) {
          paintMeasureSelectionOverlay(
            ctx,
            dl.measureBounds,
            selection.startMeasure,
            selection.endMeasure,
            selection.startStaffIndex,
            selection.endStaffIndex,
          );
        } else {
          paintSelectionOverlay(ctx, spatialIndex, selectedIds, dl, displayListVersion, args.selectionVoiceIndex);
        }
      }

      if (spatialIndex && hitboxOverlayEnabled) {
        paintHitboxDebug(ctx, spatialIndex);
      }

      if (interactionMode === "engrave" && dl?.measureBounds) {
        const pageMarginLeftPx = pageSetup.margins.left * PX_PER_MM;
        paintEngraveAdornments({
          ctx,
          measureBounds: dl.measureBounds,
          hoverBarline: engraveBarlineHover,
          adornments: engraveAdornments,
          selectedMarkerId: selectedEngraveMarkerId,
          partIdByIndex,
          pageMarginLeftPx,
          hoverEyeId: engraveEyeHoverId,
          hoverGhostRailId: engraveGhostRailHoverId,
          hoverFadeT: engraveHoverFadeT,
          slurGeometries: dl.slurGeometries,
          slurHandleDrag,
          hoverSlurHandleKey,
          selectedSlurId,
          textExpressionDrag,
        });
      } else if (interactionMode === "write" && selectedSlurId) {
        paintWriteSlurHandles(ctx, dl.slurGeometries, selectedSlurId, slurHandleDrag, hoverSlurHandleKey);
      }

      if (spannerDrag) {
        paintSnapRuler(ctx, spannerDrag.bbox, spannerDrag.hit.handle, spannerDrag.dragX, spannerDrag.snapPoints);
      }

      // Write-mode slur endpoints re-anchor onto notes and get a snap ruler.
      // Engrave handles only reshape the curve and never carry anchor state.
      if (interactionMode === "write" && slurHandleDrag?.anchor) {
        const { geom } = slurHandleDrag;
        const bbox = {
          x: Math.min(geom.p0x, geom.p3x),
          y: Math.min(geom.p0y, geom.p3y),
          width: Math.abs(geom.p3x - geom.p0x),
          height: Math.abs(geom.p3y - geom.p0y),
        };
        paintSnapRuler(
          ctx,
          bbox,
          slurHandleDrag.anchor.end,
          slurHandleDrag.anchor.dragX,
          slurHandleDrag.anchor.points,
          slurHandleDrag.anchor.dragY,
        );
      }
    };

    // Engine-space overlays (selection, engrave adornments, spanner preview)
    // are authored in engine coordinates (pages stacked at x=0). For every
    // paginated view mode we paint them inside each page's placement transform
    // — clip to the page rect, then translate engine→visual — so they track the
    // page's staves and margins regardless of how pages are arranged (vertical
    // stack, vertical spread, or horizontal spread). This is the single place
    // that maps engine→page, so the engrave adornment painter stays view-mode
    // agnostic. The `else` branch is the identity case (horizon, or single-page
    // page view with no stack gap).
    const overlayPlacements =
      (viewMode === "spread" || viewMode === "spread-h" || pageMultiStacked) && dl.pages
        ? computePagePlacements(dl, viewMode)
        : null;
    performance.mark("viritura:engine-overlays-start");
    if (overlayPlacements && dl.pages) {
      const PAGE_W_OV = dl.width;
      // Visible world rect in content coords — skip overlays for pages that
      // don't intersect the viewport. Without this, every page's engrave
      // adornments (staff-eyes, ghost rails, break markers) are painted on
      // every scroll frame, so a large multi-page score issues thousands of
      // off-screen draw calls per frame and scroll stutters.
      const ovMinXc = viewport.scrollX;
      const ovMinYc = viewport.scrollY;
      const ovMaxXc = viewport.scrollX + vw / viewport.zoom;
      const ovMaxYc = viewport.scrollY + vh / viewport.zoom;
      for (let i = 0; i < dl.pages.length; i++) {
        const page = dl.pages[i];
        const pos = overlayPlacements[i];
        if (!page || !pos) continue;
        if (pos.x + PAGE_W_OV < ovMinXc || pos.x > ovMaxXc || pos.y + page.height < ovMinYc || pos.y > ovMaxYc) {
          continue;
        }
        const { dx, dy } = placementCommandOffset(pos);
        ctx.save();
        ctx.beginPath();
        ctx.rect(pos.x, pos.y, PAGE_W_OV, page.height);
        ctx.clip();
        ctx.translate(dx, dy);
        paintEngineOverlays();
        ctx.restore();
      }
    } else {
      paintEngineOverlays();
    }
    performance.mark("viritura:engine-overlays-end");
    try {
      performance.measure("viritura:engine-overlays", "viritura:engine-overlays-start", "viritura:engine-overlays-end");
    } catch {
      /* optional performance telemetry */
    }

    // Sticky clefs + labels in horizon view
    performance.mark("viritura:sticky-total-start");
    const visibleLeftContent = viewport.scrollX + safeAreaLeft / viewport.zoom;
    if (viewMode === "horizon" && dl && visibleLeftContent > 0) {
      if (stickyClefCache.version !== displayListVersion) {
        performance.mark("viritura:sticky-derive-start");
        stickyClefCache.staves = detectHorizonStaves(dl);
        stickyClefCache.info = extractStickyClefInfo(dl, stickyClefCache.staves);
        stickyClefCache.version = displayListVersion;
        performance.mark("viritura:sticky-derive-end");
        try {
          performance.measure("viritura:sticky-derive", "viritura:sticky-derive-start", "viritura:sticky-derive-end");
        } catch {
          /* optional performance telemetry */
        }
      }
      if (stickyClefCache.staves.length > 0 && stickyClefCache.info.length > 0) {
        performance.mark("viritura:sticky-paint-start");
        const snapContentPoint = usedTileCache
          ? (x: number, y: number): { x: number; y: number } => {
              const tileSize = DEFAULT_TILE_SIZE;
              const col = Math.floor((x * viewport.zoom) / tileSize);
              const row = Math.floor((y * viewport.zoom) / tileSize);
              const rawTileX = col * tileSize * dpr - viewport.scrollX * viewport.zoom * dpr;
              const rawTileY = row * tileSize * dpr - viewport.scrollY * viewport.zoom * dpr;
              const dx = (Math.round(rawTileX) - rawTileX) / (dpr * viewport.zoom);
              const dy = (Math.round(rawTileY) - rawTileY) / (dpr * viewport.zoom);
              return { x: x + dx, y: y + dy };
            }
          : undefined;
        paintStickyClefs(
          ctx,
          stickyClefCache.staves,
          stickyClefCache.info,
          viewport.scrollX,
          viewport.zoom,
          safeAreaLeft,
          paperFill,
          snapContentPoint,
        );
        if (dl.measureBounds) {
          paintMeasureNumber(
            ctx,
            stickyClefCache.staves,
            dl.measureBounds,
            viewport.scrollX,
            viewport.zoom,
            safeAreaLeft,
            paperFill,
          );
        }
        performance.mark("viritura:sticky-paint-end");
        try {
          performance.measure("viritura:sticky-paint", "viritura:sticky-paint-start", "viritura:sticky-paint-end");
        } catch {
          /* optional performance telemetry */
        }
      }
    }
    performance.mark("viritura:sticky-total-end");
    try {
      performance.measure("viritura:sticky-total", "viritura:sticky-total-start", "viritura:sticky-total-end");
    } catch {
      /* optional performance telemetry */
    }

    // Vertical-spacing debug overlay
    if (dl.layoutDebug) {
      const { enabled, categories } = useLayoutDebugStore.getState();
      if (enabled) {
        // Visible world rect in content coordinates. The overlay culls its
        // per-box passes to this rect (see PaintLayoutDebugOpts.visible) —
        // without it the painter walks every element box in the score every
        // frame, which is O(boxes²) in the attach-gap scan and hangs the main
        // thread on large orchestral scores.
        const visMinXc = viewport.scrollX;
        const visMinYc = viewport.scrollY;
        const visMaxXc = viewport.scrollX + vw / viewport.zoom;
        const visMaxYc = viewport.scrollY + vh / viewport.zoom;
        const paged =
          (viewMode === "spread" || viewMode === "spread-h" || pageMultiStacked) && dl.pages
            ? computePagePlacements(dl, viewMode)
            : null;
        if (paged && dl.pages) {
          const PAGE_W = dl.width;
          for (let i = 0; i < dl.pages.length; i++) {
            const page = dl.pages[i];
            const pos = paged[i];
            if (!page || !pos) continue;
            // Skip pages that don't intersect the viewport at all.
            if (pos.x + PAGE_W < visMinXc || pos.x > visMaxXc || pos.y + page.height < visMinYc || pos.y > visMaxYc) {
              continue;
            }
            const { dx, dy } = placementCommandOffset(pos);
            ctx.save();
            ctx.beginPath();
            ctx.rect(pos.x, pos.y, PAGE_W, page.height);
            ctx.clip();
            paintLayoutDebug(ctx, dl.layoutDebug, {
              categories,
              zoom: viewport.zoom,
              offsetX: dx,
              offsetY: dy,
              elementBboxes: dl.elementBboxes,
              // Painter draws at engine coords after translate(dx,dy); map the
              // content-space visible rect back into engine space.
              visible: {
                minX: visMinXc - dx,
                minY: visMinYc - dy,
                maxX: visMaxXc - dx,
                maxY: visMaxYc - dy,
              },
            });
            ctx.restore();
          }
        } else {
          paintLayoutDebug(ctx, dl.layoutDebug, {
            categories,
            zoom: viewport.zoom,
            elementBboxes: dl.elementBboxes,
            visible: { minX: visMinXc, minY: visMinYc, maxX: visMaxXc, maxY: visMaxYc },
          });
        }
      }
    }
  }

  performance.mark("viritura:post-score-paint-end");
  try {
    performance.measure(
      "viritura:post-score-paint",
      "viritura:post-score-paint-start",
      "viritura:post-score-paint-end",
    );
  } catch {
    /* optional performance telemetry */
  }

  endFrame();

  performance.mark("viritura:paint-end");
  try {
    performance.measure("viritura:canvas-paint", "viritura:raf-callback", "viritura:paint-end");
  } catch {
    /* ignore */
  }
  try {
    performance.measure("viritura:edit-to-paint", "viritura:edit-start", "viritura:paint-end");
    performance.clearMarks("viritura:edit-start");
    performance.clearMarks("viritura:setState-done");
  } catch {
    /* ignore — no edit-start mark for non-edit repaints */
  }
  try {
    const virituraWindow = window as typeof window & { __VIRITURA_OPTIMISTIC_INPUT_PAINTED__?: boolean };
    if (virituraWindow.__VIRITURA_OPTIMISTIC_INPUT_PAINTED__) {
      virituraWindow.__VIRITURA_OPTIMISTIC_INPUT_PAINTED__ = false;
    } else {
      const m = performance.measure("viritura:input-to-paint", "viritura:input-event", "viritura:paint-end");
      perfTracker.inputToPaintMs = m.duration;
    }
    performance.clearMarks("viritura:input-event");
  } catch {
    /* no input-event mark for non-edit repaints */
  }

  // Feed tile cache stats into PerfTracker for the overlay. `usedTiles`
  // reflects the branch ACTUALLY taken this frame (tracked in usedTileCache) —
  // not merely `!forceDirect`, which mislabelled zoom-gesture and spread-mode
  // frames as tiled even though they painted directly. `tileCacheDisabled` is
  // the separate global kill-switch, so the overlay can distinguish "this frame
  // painted directly" from "the tile cache is turned off entirely."
  {
    perfTracker.usedTiles = usedTileCache;
    perfTracker.tileCacheDisabled = isTileCacheDisabled();
    perfTracker.tilesCached = tileCache.tilesCached;
    perfTracker.tilesRendered = tileCache.tilesRendered;
  }

  if (performanceOverlayEnabled && ctx) {
    // Position the overlay just right of the floating left panel (safeAreaLeft
    // already includes the panel's right edge plus padding) so it isn't hidden
    // behind the panel.
    perfTracker.drawOverlay(ctx, canvas.width, canvas.height, { leftOffset: safeAreaLeft });
  }
}

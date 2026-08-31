import {
  computeHorizonPaperGeometry,
  paintCommandsCulled,
  paintCommand,
  paintPaperPage,
  paintSelectionOverlay,
  paintMeasureSelectionOverlay,
  paintSpannerDragPreview,
  splitCommandsByPage,
  type DisplayList,
  type GlyphAtlas,
  type SpatialIndex,
} from "@viritura/renderer";
import { useLayoutDebugStore } from "../../debug/layoutDebugStore";
import { paintLayoutDebug } from "../../debug/layoutDebugPainter";
import { getPaperPattern } from "./paperPattern";
import { PAGE_STACK_GAP, computePagePlacements, placementCommandOffset } from "./viewportGeometry";
import { suppressElementCommands } from "./dragPreviewSuppression";

export interface RepaintCanvasArgs {
  canvas: HTMLCanvasElement;
  displayList: DisplayList;
  scrollX: number;
  scrollY: number;
  zoom: number;
  glyphAtlas?: GlyphAtlas | null;
  spatialIndex?: SpatialIndex | null;
  selectedIds?: ReadonlySet<string>;
  dragPreview?: {
    bbox: { x: number; y: number; width: number; height: number };
    handle: "start" | "end";
    dragX: number;
    snapPoints?: Array<{ x: number; beat: number; measureIndex: number; active?: boolean }>;
  } | null;
  viewMode?: "page" | "spread" | "spread-h" | "horizon";
  measureSelection?: { startMeasure: number; endMeasure: number; startPart: number; endPart: number } | null;
  /** Element whose engine-rendered ink is replaced by a live drag preview. */
  suppressedElementId?: string;
  printableInsets?: PageInsets;
}

export interface PageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function pageBottomClipRect(
  x: number,
  y: number,
  width: number,
  height: number,
  insets: PageInsets,
): { x: number; y: number; width: number; height: number } {
  return {
    x,
    y,
    width,
    height: Math.max(0, height - insets.bottom),
  };
}

function clipPrintablePage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  insets: PageInsets,
): void {
  const rect = pageBottomClipRect(x, y, width, height, insets);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
}

// eslint-disable-next-line max-statements, complexity -- top-level Canvas2D paint orchestrator: DPR setup → clear → page background → tile loop with sticky clef cache → display-list paint → playhead overlay → selection overlay → spanner-drag preview → measure-selection rectangle. Each overlay is a few draw calls sharing the same transformed ctx; sub-painters are already extracted (paintScoreFrame, paintEngraveAdornments). The remaining body is the per-frame conductor.
export function repaintCanvas(args: RepaintCanvasArgs): void {
  const {
    canvas,
    displayList: sourceDisplayList,
    scrollX,
    scrollY,
    zoom,
    glyphAtlas,
    spatialIndex,
    selectedIds,
    dragPreview,
    viewMode = "page",
    measureSelection,
    suppressedElementId,
    printableInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  } = args;
  const displayList = suppressedElementId
    ? suppressElementCommands(sourceDisplayList, suppressedElementId)
    : sourceDisplayList;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  // Bake glyphs at the exact device scale this frame paints at, so atlas blits
  // are 1:1 with device pixels instead of being resampled (and aliased).
  glyphAtlas?.ensureDeviceScale(dpr * zoom);

  // Reset transform and clear entire canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Fill with neutral workspace background for all view modes
  const canvasBg = getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() || "#e0e2ea";
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Resolve the paper fill for page cards. Returns the textured pattern if
  // already loaded; otherwise we use the cream substrate solid and trigger
  // a re-paint when the pattern resolves. Single source of truth: the
  // `--paper-bg` CSS variable (same as palette tiles & radial menu).
  const paper = getPaperPattern(ctx);
  const paperFill: string | CanvasPattern = paper.pattern ?? paper.cream;
  if (paper.ready) {
    paper.ready.then(() => {
      // Request a re-render once the paper image has loaded.
      window.dispatchEvent(new CustomEvent("viritura:paper-ready"));
    });
  }

  // Apply viewport transform: DPR × zoom, offset by scroll
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * dpr * zoom, -scrollY * dpr * zoom);

  // Visible content rectangle (in score/content coordinates), padded so glyphs
  // straddling the edge aren't clipped. Used to cull off-screen commands and
  // whole off-screen pages — essential in spread view, which always paints
  // directly (no tile cache) and would otherwise draw every command of every
  // page each frame, hanging on large multi-page scores.
  const CULL_MARGIN = 64;
  const viewW = canvas.width / (dpr * zoom);
  const viewH = canvas.height / (dpr * zoom);
  const visX1 = scrollX - CULL_MARGIN;
  const visY1 = scrollY - CULL_MARGIN;
  const visX2 = scrollX + viewW + CULL_MARGIN;
  const visY2 = scrollY + viewH + CULL_MARGIN;

  const frame: FramePaintCtx = {
    displayList,
    glyphAtlas,
    spatialIndex,
    selectedIds,
    dragPreview,
    measureSelection,
    zoom,
    paperFill,
    visX1,
    visY1,
    visX2,
    visY2,
    printableInsets,
  };

  // Horizon (galley) mode: draw paper content area with padding.
  // Render it as a floating paper card using the shared --paper-shadow
  // recipe so it matches palette tiles, radial menu, library cards, etc.
  if (viewMode === "horizon") {
    const paper = computeHorizonPaperGeometry(displayList);
    paintPaperPage(ctx, paper.x, paper.y, paper.width, paper.height, paperFill);
  }

  // ─── Spread view: side-by-side pages like a book ───────
  if ((viewMode === "spread" || viewMode === "spread-h") && displayList.pages && displayList.pages.length > 0) {
    paintSpreadView(ctx, viewMode, frame);
    return; // spread rendering complete
  }

  // Page view: render paper rectangles with the shared --paper-shadow
  // recipe (matches palette tiles, radial menu, library cards). With
  // PAGE_STACK_GAP > 0 each page is shifted down by pageIdx * gap so the
  // pages have visible separation, matching the inter-spread gap in
  // spread view.
  if (viewMode === "page" && displayList.pages && displayList.pages.length > 0) {
    const PAGE_W = displayList.width;
    const pages = displayList.pages;
    const multiPage = pages.length > 1 && PAGE_STACK_GAP > 0;

    // Paint paper rects first. Page positions come from the shared
    // single-source placement geometry (see computePagePlacements).
    const placements = computePagePlacements(displayList, "page");
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page) continue;
      const pos = placements[i]!;
      paintPaperPage(ctx, 0, pos.y, PAGE_W, page.height, paperFill);
    }

    if (multiPage) {
      // Per-page render of commands AND overlays so everything shifts in
      // lockstep with the page rect. Clipping hides commands/overlays from
      // adjacent pages so cross-page slurs etc. don't bleed into the gap.
      // displayList is NOT mutated (PDF export shares this ref).
      const split = splitCommandsByPage(displayList);
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page) continue;
        const { dy } = placementCommandOffset(placements[i]!);
        // Skip pages entirely outside the viewport. Like the spread branch,
        // this bounds the direct paint to visible pages — without it every
        // page is iterated (and any command lacking cull bounds is drawn)
        // each frame, making the direct path O(all pages) and hanging on
        // large multi-page scores in engrave mode.
        const pageTop = page.yOffset + dy;
        if (PAGE_W < visX1 || 0 > visX2 || pageTop + page.height < visY1 || pageTop > visY2) continue;
        ctx.save();
        // Clip in visual coords so overlays drawn at engine Y for other
        // pages get culled (we still paint the full overlay each pass —
        // cheap, simpler than splitting overlay state by page).
        clipPrintablePage(ctx, 0, page.yOffset + dy, PAGE_W, page.height, printableInsets);
        ctx.translate(0, dy);

        const entry = split[i];
        if (entry) {
          paintCommandsCulled(ctx, entry.commands, glyphAtlas ?? null, visX1, visX2, visY1 - dy, visY2 - dy);
        }
        if (measureSelection && displayList.measureBounds) {
          paintMeasureSelectionOverlay(
            ctx,
            displayList.measureBounds,
            measureSelection.startMeasure,
            measureSelection.endMeasure,
            measureSelection.startPart,
            measureSelection.endPart,
          );
        } else if (spatialIndex && selectedIds && selectedIds.size > 0) {
          paintSelectionOverlay(ctx, spatialIndex, selectedIds, displayList);
        }
        if (dragPreview) {
          paintSpannerDragPreview(ctx, dragPreview.bbox, dragPreview.handle, dragPreview.dragX, dragPreview.snapPoints);
        }
        paintLayoutDebugIfEnabled(ctx, displayList, zoom, {
          minX: visX1,
          minY: visY1 - dy,
          maxX: visX2,
          maxY: visY2 - dy,
        });
        ctx.restore();
      }
      return;
    }

    const page = pages[0]!;
    ctx.save();
    clipPrintablePage(ctx, 0, page.yOffset, PAGE_W, page.height, printableInsets);
    paintCommandsCulled(ctx, displayList.commands, glyphAtlas ?? null, visX1, visX2, visY1, visY2);
    ctx.restore();
  } else if (viewMode === "horizon" && paintRetainedHorizonLayers(ctx, frame)) {
    // PatchFrame partitions provide a coarse system index, avoiding an O(all
    // commands) bounds walk for a viewport that intersects only a few systems.
  } else {
    paintCommandsCulled(ctx, displayList.commands, glyphAtlas ?? null, visX1, visX2, visY1, visY2);
  }

  // Paint selection overlay
  if (measureSelection && displayList.measureBounds) {
    paintMeasureSelectionOverlay(
      ctx,
      displayList.measureBounds,
      measureSelection.startMeasure,
      measureSelection.endMeasure,
      measureSelection.startPart,
      measureSelection.endPart,
    );
  } else if (spatialIndex && selectedIds && selectedIds.size > 0) {
    paintSelectionOverlay(ctx, spatialIndex, selectedIds, displayList);
  }

  // Paint spanner drag preview
  if (dragPreview) {
    paintSpannerDragPreview(ctx, dragPreview.bbox, dragPreview.handle, dragPreview.dragX, dragPreview.snapPoints);
  }

  // Paint vertical-spacing debug overlay (when enabled)
  paintLayoutDebugIfEnabled(ctx, displayList, zoom, {
    minX: visX1,
    minY: visY1,
    maxX: visX2,
    maxY: visY2,
  });
}

function paintRetainedHorizonLayers(ctx: CanvasRenderingContext2D, frame: FramePaintCtx): boolean {
  const layers = frame.displayList.retainedRenderLayers;
  if (!layers?.length) return false;

  for (const layer of layers) {
    const bounds = layer.bounds;
    if (
      bounds &&
      bounds.x2 >= frame.visX1 &&
      bounds.x <= frame.visX2 &&
      bounds.y2 >= frame.visY1 &&
      bounds.y <= frame.visY2
    ) {
      paintCommandsCulled(
        ctx,
        layer.displayList.commands,
        frame.glyphAtlas ?? null,
        frame.visX1,
        frame.visX2,
        frame.visY1,
        frame.visY2,
      );
    } else {
      for (const command of layer.stateCommands) paintCommand(ctx, command);
    }
  }
  return true;
}

/** Shared per-frame paint state passed to the view-mode sub-painters. */
interface FramePaintCtx {
  displayList: DisplayList;
  glyphAtlas?: GlyphAtlas | null;
  spatialIndex?: SpatialIndex | null;
  selectedIds?: ReadonlySet<string>;
  dragPreview?: RepaintCanvasArgs["dragPreview"];
  measureSelection?: RepaintCanvasArgs["measureSelection"];
  zoom: number;
  paperFill: string | CanvasPattern;
  visX1: number;
  visY1: number;
  visX2: number;
  visY2: number;
  printableInsets: PageInsets;
}

// eslint-disable-next-line max-statements, complexity -- spread-view (open-book) painter: paper-card loop with binding-gutter gradients → per-page clip+translate command paint → selection/measure overlays → debug overlay. Already a single coherent sub-concept extracted from repaintCanvas; the remaining length is the gutter-gradient detail, not separable logic.
function paintSpreadView(ctx: CanvasRenderingContext2D, viewMode: "spread" | "spread-h", c: FramePaintCtx): void {
  const { displayList, glyphAtlas, spatialIndex, selectedIds, dragPreview, measureSelection, zoom, paperFill } = c;
  const { visX1, visY1, visX2, visY2, printableInsets } = c;
  const PAGE_W = displayList.width;
  const pages = displayList.pages!;

  // Single source of truth for page positions (shared with hit-testing and
  // content-size). See computePagePlacements in viewportGeometry.
  const placements = computePagePlacements(displayList, viewMode);

  // Draw spread rects with the shared --paper-shadow recipe. Facing
  // pages of a spread are painted as ONE paper sheet (no inner gap) so
  // the spread reads like an open book; a subtle 1px gutter line marks
  // the binding. Page i=0 is alone (cover); subsequent pages pair up
  // (i odd = left, i even = right).
  const drawnIdx = new Set<number>();
  for (let i = 0; i < pages.length; i++) {
    if (drawnIdx.has(i)) continue;
    const page = pages[i]!;
    const pos = placements[i]!;
    const isPairLeft = i > 0 && i % 2 === 1 && i + 1 < pages.length;
    if (isPairLeft) {
      const rightPage = pages[i + 1]!;
      const rightPos = placements[i + 1]!;
      const spreadW = rightPos.x + PAGE_W - pos.x;
      const spreadH = Math.max(page.height, rightPage.height);
      drawnIdx.add(i);
      drawnIdx.add(i + 1);
      // Skip the (relatively costly) gutter gradients for off-screen spreads.
      if (pos.x + spreadW < visX1 || pos.x > visX2 || pos.y + spreadH < visY1 || pos.y > visY2) continue;
      paintPaperPage(ctx, pos.x, pos.y, spreadW, spreadH, paperFill);
      // Binding gutter — soft inner-shadow on each side of the spine
      // simulating the page curl into the binding, with a crisp 1px
      // crease line at the seam. The shadow ramps with an ease-in
      // curve (alpha ~ t^2.2) instead of a linear gradient, so it
      // reads as a curved piece of paper folding into the spine
      // rather than a flat gradient.
      const gutterX = pos.x + PAGE_W;
      const gutterTop = pos.y;
      const gutterBot = pos.y + spreadH;
      const gutterWidth = 22; // px each side
      const peakAlpha = 0.22;
      // 9 stops sampled along alpha = peakAlpha * t^2.2 give a smooth
      // curve indistinguishable from a continuous easing function.
      const curveStops: Array<[number, number]> = [];
      for (let s = 0; s <= 8; s++) {
        const t = s / 8;
        const a = peakAlpha * Math.pow(t, 2.2);
        curveStops.push([t, a]);
      }
      ctx.save();
      // Left-page curl (transparent at outer edge → dark at spine)
      const leftGrad = ctx.createLinearGradient(gutterX - gutterWidth, 0, gutterX, 0);
      for (const [t, a] of curveStops) {
        leftGrad.addColorStop(t, `rgba(60, 40, 20, ${a.toFixed(4)})`);
      }
      ctx.fillStyle = leftGrad;
      ctx.fillRect(gutterX - gutterWidth, gutterTop, gutterWidth, spreadH);
      // Right-page curl (mirror: dark at spine → transparent at outer edge)
      const rightGrad = ctx.createLinearGradient(gutterX, 0, gutterX + gutterWidth, 0);
      for (const [t, a] of curveStops) {
        rightGrad.addColorStop(1 - t, `rgba(60, 40, 20, ${a.toFixed(4)})`);
      }
      ctx.fillStyle = rightGrad;
      ctx.fillRect(gutterX, gutterTop, gutterWidth, spreadH);
      // Crisp spine crease (1px)
      ctx.strokeStyle = "rgba(40, 25, 10, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gutterX + 0.5, gutterTop + 2);
      ctx.lineTo(gutterX + 0.5, gutterBot - 2);
      ctx.stroke();
      ctx.restore();
    } else {
      drawnIdx.add(i);
      if (pos.x + PAGE_W < visX1 || pos.x > visX2 || pos.y + page.height < visY1 || pos.y > visY2) continue;
      paintPaperPage(ctx, pos.x, pos.y, PAGE_W, page.height, paperFill);
    }
  }

  // Paint commands per page with clip+translate
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const pos = placements[i]!;
    // Skip pages entirely outside the viewport. Without this, every page
    // re-scans the full command list (clipping only hides output, the
    // paintCommand calls still run), making spread view O(pages × commands)
    // per frame and hanging on large scores.
    if (pos.x + PAGE_W < visX1 || pos.x > visX2 || pos.y + page.height < visY1 || pos.y > visY2) continue;
    const { dx, dy } = placementCommandOffset(pos);

    ctx.save();
    clipPrintablePage(ctx, pos.x, pos.y, PAGE_W, page.height, printableInsets);
    ctx.translate(dx, dy);

    // Cull to this page's visible band (in command/engine coordinates).
    paintCommandsCulled(ctx, displayList.commands, glyphAtlas ?? null, visX1 - dx, visX2 - dx, visY1 - dy, visY2 - dy);

    // Paint selection overlays within this page's context
    if (measureSelection && displayList.measureBounds) {
      paintMeasureSelectionOverlay(
        ctx,
        displayList.measureBounds,
        measureSelection.startMeasure,
        measureSelection.endMeasure,
        measureSelection.startPart,
        measureSelection.endPart,
      );
    } else if (spatialIndex && selectedIds && selectedIds.size > 0) {
      paintSelectionOverlay(ctx, spatialIndex, selectedIds, displayList);
    }

    // Vertical-spacing debug overlay (per spread page)
    paintLayoutDebugIfEnabled(ctx, displayList, zoom, {
      minX: visX1 - dx,
      minY: visY1 - dy,
      maxX: visX2 - dx,
      maxY: visY2 - dy,
    });

    ctx.restore();
  }

  // Paint spanner drag preview (in original coordinates for now)
  if (dragPreview) {
    paintSpannerDragPreview(ctx, dragPreview.bbox, dragPreview.handle, dragPreview.dragX, dragPreview.snapPoints);
  }
}

/** Apply the layout debug overlay if enabled in the store. Coordinate
 *  space matches the engine output (no per-page transform). The `visible`
 *  rect (engine coords for the page being painted) bounds the overlay's heavy
 *  per-box passes — without it the painter walks every element box in the
 *  score every frame (O(boxes²) in the attach-gap scan), hanging the main
 *  thread on large orchestral scores. */
function paintLayoutDebugIfEnabled(
  ctx: CanvasRenderingContext2D,
  displayList: DisplayList,
  zoom: number,
  visible?: { minX: number; minY: number; maxX: number; maxY: number },
  offsetX = 0,
  offsetY = 0,
): void {
  if (!displayList.layoutDebug) return;
  const { enabled, categories } = useLayoutDebugStore.getState();
  if (!enabled) return;
  paintLayoutDebug(ctx, displayList.layoutDebug, {
    categories,
    zoom,
    offsetX,
    offsetY,
    elementBboxes: displayList.elementBboxes,
    visible,
  });
}

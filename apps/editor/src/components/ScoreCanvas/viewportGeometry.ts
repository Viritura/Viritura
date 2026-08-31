import type { DisplayList } from "@viritura/renderer";

/** Constants for spread layout positioning. */
const SPREAD_GAP = 0; // facing pages of a spread touch (one paper sheet)
export const SPREAD_ROW_GAP = 80; // gap between spread rows (vertical mode)
const SPREAD_TURN_GAP = 120; // gap between spreads (horizontal mode)
/** Vertical gap between stacked pages in page view (matches SPREAD_ROW_GAP). */
export const PAGE_STACK_GAP = 80;

/**
 * Where a single page sits within the viewport for a given view mode.
 *
 * This is the **single source of truth for view-mode page geometry** on the
 * editor side. Every direct-paint path (`repaintCanvas`, plus the margin-guide
 * and layout-debug overlays in `paintScoreFrame`) and every hit-test path
 * (`visualToEngineCoords`) derives page positions from here, so performance
 * work (e.g. viewport culling) and layout changes are written once and reused
 * across all modes and activities (Write/Publish/Engrave). Do NOT recompute
 * page positions inline — extend this instead.
 *
 * (The renderer's tile cache paints each page at its raw engine `yOffset`
 * with no inter-page gap, so it has no placement to share; the visual
 * page-stack / spread offsets are an editor-side presentation concern.)
 *
 * Coordinate contract:
 * - `x`/`y` are the visual top-left of the page's paper sheet (score coords).
 * - Commands are authored in *engine* coords where every page starts at x=0
 *   and y=`engineYOffset`. To paint a page, translate by
 *   `dx = x` and `dy = y - engineYOffset` (see `placementCommandOffset`).
 * - Horizon mode has no page subdivision (one continuous galley) and returns
 *   an empty array; callers handle it as a single flat surface.
 */
export interface PagePlacement {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Engine Y where this page's content starts (`page.yOffset`). */
  engineYOffset: number;
}

/** Command translate to paint a page authored in engine coords at its placement. */
export function placementCommandOffset(p: PagePlacement): { dx: number; dy: number } {
  // Engine pages start at x=0, so dx is simply the page's visual x.
  return { dx: p.x, dy: p.y - p.engineYOffset };
}

/**
 * Compute the visual placement of every page for a view mode. Single source of
 * truth — see {@link PagePlacement}. Returns `[]` for horizon (no pages) and
 * for display lists without page metadata.
 */
export function computePagePlacements(
  dl: DisplayList,
  viewMode: "page" | "spread" | "spread-h" | "horizon",
): PagePlacement[] {
  if (viewMode === "horizon" || !dl.pages || dl.pages.length === 0) return [];
  const pages = dl.pages;
  const pageW = dl.width;

  if (viewMode === "spread-h") {
    const positions = computeSpreadHPagePositions(pages, pageW);
    return pages.map((page, i) => ({
      pageIndex: i,
      x: positions[i]!.x,
      y: positions[i]!.y,
      width: pageW,
      height: page.height,
      engineYOffset: page.yOffset,
    }));
  }

  if (viewMode === "spread") {
    const placements: PagePlacement[] = [];
    let rowY = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!;
      // Page 0 opens on the right (recto); subsequent pages pair left/right.
      const x = i === 0 || i % 2 === 0 ? pageW + SPREAD_GAP : 0;
      placements.push({ pageIndex: i, x, y: rowY, width: pageW, height: page.height, engineYOffset: page.yOffset });
      if (i === 0 || i % 2 === 0) rowY += page.height + SPREAD_ROW_GAP;
    }
    return placements;
  }

  // Page view: pages stacked vertically with PAGE_STACK_GAP between them.
  return pages.map((page, i) => ({
    pageIndex: i,
    x: 0,
    y: page.yOffset + i * PAGE_STACK_GAP,
    width: pageW,
    height: page.height,
    engineYOffset: page.yOffset,
  }));
}

/**
 * Compute content dimensions for page view.
 *
 * Uses the page-layout bounds (yOffset + height for the last page) rather
 * than displayList.height, which only covers the music content. Without
 * this fix, a partially-filled last page would let the scroll clamp cut off
 * at the bottom of the music instead of the bottom of the physical page.
 */
export function computePageViewContentSize(dl: DisplayList): { width: number; height: number } {
  if (!dl.pages || dl.pages.length === 0) {
    return { width: dl.width, height: dl.height };
  }
  const lastPage = dl.pages[dl.pages.length - 1]!;
  const stackGap = (dl.pages.length - 1) * PAGE_STACK_GAP;
  return { width: dl.width, height: lastPage.yOffset + lastPage.height + stackGap };
}

/**
 * Convert a page-view visual Y (with cumulative inter-page gaps applied)
 * into engine Y (no gaps). Returns null when the visual point lies inside
 * an inter-page gap region.
 */
function pageViewVisualToEngineY(visualY: number, dl: DisplayList): number | null {
  if (!dl.pages || dl.pages.length === 0) return visualY;
  const gap: number = PAGE_STACK_GAP;
  if (gap === 0) return visualY;
  for (let i = 0; i < dl.pages.length; i++) {
    const page = dl.pages[i]!;
    const bandTop = page.yOffset + i * gap;
    const bandBot = bandTop + page.height;
    if (visualY >= bandTop && visualY <= bandBot) {
      return visualY - i * gap;
    }
    if (visualY < bandTop) return null; // in gap above this page
  }
  return null; // past last page
}

/** Compute content dimensions adjusted for spread view mode. */
export function computeSpreadContentSize(dl: DisplayList): { width: number; height: number } {
  if (!dl.pages || dl.pages.length === 0) {
    return { width: dl.width, height: dl.height };
  }
  const pageW = dl.width;
  const totalW = pageW * 2 + SPREAD_GAP;
  let totalH = 0;
  const pageCount = dl.pages.length;
  if (pageCount >= 1) {
    totalH += dl.pages[0]!.height; // first page alone
  }
  // Spread rows: pairs of pages
  const pairCount = Math.ceil((pageCount - 1) / 2);
  for (let p = 0; p < pairCount; p++) {
    totalH += SPREAD_ROW_GAP;
    const leftIdx = 1 + p * 2;
    const leftPage = dl.pages[leftIdx];
    const rightPage = dl.pages[leftIdx + 1];
    totalH += Math.max(leftPage?.height ?? 0, rightPage?.height ?? 0);
  }
  return { width: totalW, height: totalH };
}

/**
 * Convert visual (viewport) score coordinates to engine coordinates for a
 * paged view mode (spread / spread-h) by reversing each page's placement
 * transform. Shared placement geometry (see {@link computePagePlacements})
 * keeps hit-testing and painting in lockstep.
 */
function pagedVisualToEngineCoords(
  visualX: number,
  visualY: number,
  dl: DisplayList,
  viewMode: "spread" | "spread-h",
): { engineX: number; engineY: number } | null {
  const PAGE_W = dl.width;
  for (const p of computePagePlacements(dl, viewMode)) {
    if (visualX >= p.x && visualX <= p.x + PAGE_W && visualY >= p.y && visualY <= p.y + p.height) {
      const { dx, dy } = placementCommandOffset(p);
      return { engineX: visualX - dx, engineY: visualY - dy };
    }
  }
  return null; // clicked outside any page
}

/** Compute content dimensions for horizontal spread view mode. */
export function computeSpreadHContentSize(dl: DisplayList): { width: number; height: number } {
  if (!dl.pages || dl.pages.length === 0) {
    return { width: dl.width, height: dl.height };
  }
  const pageW = dl.width;
  const spreadW = pageW * 2 + SPREAD_GAP;
  const pageCount = dl.pages.length;
  const spreadCount = 1 + (pageCount > 1 ? Math.ceil((pageCount - 1) / 2) : 0);
  const totalW = spreadCount * spreadW + (spreadCount - 1) * SPREAD_TURN_GAP;
  let maxH = 0;
  for (const p of dl.pages) {
    if (p && p.height > maxH) maxH = p.height;
  }
  return { width: totalW, height: maxH };
}

/** Compute page positions for horizontal spread mode. */
function computeSpreadHPagePositions(
  pages: NonNullable<DisplayList["pages"]>,
  pageW: number,
): Array<{ x: number; y: number }> {
  const spreadW = pageW * 2 + SPREAD_GAP;
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pages.length; i++) {
    if (i === 0) {
      positions.push({ x: pageW + SPREAD_GAP, y: 0 });
    } else if (i % 2 === 1) {
      const spreadIdx = Math.ceil(i / 2);
      positions.push({ x: spreadIdx * (spreadW + SPREAD_TURN_GAP), y: 0 });
    } else {
      const spreadIdx = i / 2;
      positions.push({ x: spreadIdx * (spreadW + SPREAD_TURN_GAP) + pageW + SPREAD_GAP, y: 0 });
    }
  }
  return positions;
}

/**
 * Unified visual→engine coordinate converter. Dispatches to the per-mode
 * helper. For horizon view returns identity. For page view with a single
 * page or no stack gap also returns identity. For multi-page page view,
 * accounts for the inter-page gap by mapping visual Y back to engine Y
 * (returns null when the visual point lies inside an inter-page gap).
 */
export function visualToEngineCoords(
  visualX: number,
  visualY: number,
  dl: DisplayList,
  viewMode: "page" | "spread" | "spread-h" | "horizon",
): { engineX: number; engineY: number } | null {
  if (viewMode === "spread-h" || viewMode === "spread")
    return pagedVisualToEngineCoords(visualX, visualY, dl, viewMode);
  if (viewMode === "page" && dl.pages && dl.pages.length > 1 && PAGE_STACK_GAP > 0) {
    const eY = pageViewVisualToEngineY(visualY, dl);
    if (eY === null) return null;
    return { engineX: visualX, engineY: eY };
  }
  return { engineX: visualX, engineY: visualY };
}

/** Draw dashed margin guides inside a page rectangle. */
export function drawMarginGuides(
  ctx: CanvasRenderingContext2D,
  pageX: number,
  pageY: number,
  pageW: number,
  pageH: number,
  marginTop: number,
  marginRight: number,
  marginBottom: number,
  marginLeft: number,
): void {
  const x1 = pageX + marginLeft;
  const y1 = pageY + marginTop;
  const x2 = pageX + pageW - marginRight;
  const y2 = pageY + pageH - marginBottom;
  ctx.save();
  ctx.strokeStyle = "rgba(66, 133, 244, 0.4)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  ctx.restore();
}

/**
 * Convert CSS-pixel screen coordinates to layout ("score") coordinates,
 * accounting for zoom and scroll. The renderer keeps all DisplayList stores
 * in a single coordinate system, so no offset adjustment is required here.
 *
 * Single source of truth for screen→layout conversion. All pointer event
 * handlers should use this instead of computing scoreX/scoreY inline.
 */
export function screenToLayout(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  zoom: number,
  scrollX: number,
  scrollY: number,
): { scoreX: number; scoreY: number } {
  return {
    scoreX: (clientX - rect.left) / zoom + scrollX,
    scoreY: (clientY - rect.top) / zoom + scrollY,
  };
}

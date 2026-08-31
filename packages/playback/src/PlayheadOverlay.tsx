import { useEffect, useEffectEvent, useRef, type CSSProperties } from "react";
import {
  detectStaves,
  paintPlayheadAtPosition,
  beatToX,
  findSystemYExtent,
  findPageForY,
  paintPlayhead,
  type DisplayList,
  type PlayheadPosition,
  type StaffInfo,
} from "@viritura/renderer";
import type { ViewMode } from "./types";

/**
 * The playhead's drawn rectangle in **content coordinates** — the same space as
 * `scrollX`/`scrollY` (pre-zoom, pre-scroll). Reported via `onPlayheadRect` so a
 * parent can drive auto-scroll: `x` is the cursor line, `yTop`/`yBottom` bound
 * the system so a tall score can be scrolled fully into view.
 */
export interface PlayheadRect {
  x: number;
  yTop: number;
  yBottom: number;
}

const PLAYHEAD_CANVAS_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  pointerEvents: "none",
  zIndex: 5,
};

/**
 * Spread layout constants — MUST match the editor's single source of truth in
 * `@viritura/editor` `ScoreCanvas/viewportGeometry.ts` (`computePagePlacements`
 * and friends). These are duplicated here because the playback package can't
 * import from the editor package; keep the values in lockstep with that file.
 *
 * A mismatch here makes the spread-h playhead drift further behind with each
 * spread (the per-spread X step is `spreadW + SPREAD_TURN_GAP`, so any error
 * accumulates).
 */
const SPREAD_GAP = 0; // facing pages of a spread touch (one paper sheet)
const SPREAD_ROW_GAP = 80; // gap between spread rows (vertical mode)
const SPREAD_TURN_GAP = 120; // gap between spreads (horizontal mode)

interface PlayheadOverlayProps {
  /** Current playhead position, or null when not playing. */
  playheadPosition: PlayheadPosition | null;
  /** Current display list for measure bounds and staff detection. */
  displayList: DisplayList | null;
  /** Viewport scroll X in score coordinates. */
  scrollX: number;
  /** Viewport scroll Y in score coordinates. */
  scrollY: number;
  /** Current zoom level. */
  zoom: number;
  /** Optional color override for the playhead line. */
  color?: string;
  /**
   * Called every painted frame with the playhead's content-space rectangle
   * (or null when it can't be resolved / playback is stopped), enabling the
   * parent to implement auto-scroll / follow-the-playhead behavior.
   */
  onPlayheadRect?: (rect: PlayheadRect | null) => void;
  /** Current view mode — affects coordinate transforms for spread layout. */
  viewMode?: ViewMode;
}

/**
 * PlayheadOverlay — renders a playhead cursor on a transparent overlay canvas
 * during audio playback, avoiding re-rendering the score canvas.
 *
 * Uses requestAnimationFrame for smooth ~60fps rendering.
 * The overlay canvas sits on top of the score canvas (pointer-events: none).
 */
export function PlayheadOverlay({
  playheadPosition,
  displayList,
  scrollX,
  scrollY,
  zoom,
  color,
  onPlayheadRect,
  viewMode = "horizon",
}: PlayheadOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stavesRef = useRef<StaffInfo[]>([]);
  const rafRef = useRef(0);
  const runningRef = useRef(false);

  // Detect staves whenever the display list changes
  useEffect(() => {
    if (displayList) {
      stavesRef.current = detectStaves(displayList);
    } else {
      stavesRef.current = [];
    }
  }, [displayList]);

  // Effect Event: always sees the latest committed prop values when called from
  // inside an Effect, without forcing the rAF loop to restart on every render.
  // Replaces a ref-bag that previously mirrored 8 props for the loop to read.
  // See https://react.dev/reference/react/useEffectEvent#using-a-timer-with-latest-values
  const onPaintFrame = useEffectEvent(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!playheadPosition || !displayList) {
      onPlayheadRect?.(null);
      return;
    }

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * dpr * zoom, -scrollY * dpr * zoom);

    if ((viewMode === "spread" || viewMode === "spread-h") && displayList.pages && displayList.pages.length > 0) {
      const rect = paintPlayheadInSpread(ctx, displayList, playheadPosition, stavesRef.current, viewMode, color);
      onPlayheadRect?.(rect);
    } else {
      // Horizon and page view: engine coordinates match visual coordinates
      const draw = paintPlayheadAtPosition(ctx, playheadPosition, displayList, stavesRef.current, color);
      onPlayheadRect?.(draw);
    }
  });

  // Continuous rAF loop while playhead is active. Only re-fires on null↔non-null
  // transitions of playheadPosition; intra-playback mutations flow through the
  // Effect Event above without restarting the loop.
  const playheadActive = playheadPosition !== null;
  useEffect(() => {
    if (!playheadActive) {
      runningRef.current = false;
      // Clear canvas when playhead disappears
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    runningRef.current = true;
    const loop = () => {
      if (!runningRef.current) return;
      onPaintFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [playheadActive]);

  // Resize overlay canvas to match the sibling score canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const scoreCanvas = canvas.parentElement?.querySelector("canvas:not([data-testid])") as HTMLCanvasElement | null;
      if (!scoreCanvas) return;
      const dpr = window.devicePixelRatio || 1;
      const vw = scoreCanvas.clientWidth;
      const vh = scoreCanvas.clientHeight;
      canvas.width = vw * dpr;
      canvas.height = vh * dpr;
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
    };

    resize();
    const parent = canvas.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [displayList, zoom]);

  return <canvas ref={canvasRef} data-testid="playhead-overlay" style={PLAYHEAD_CANVAS_STYLE} />;
}

/**
 * Paint the playhead in spread or spread-h view. Computes the engine X,
 * resolves which page the current measure sits on, applies the spread
 * offset for that page, and draws the line. Returns the playhead's visual
 * content-space rect (used by callers for auto-scroll) or null if the
 * position couldn't be resolved.
 */
function paintPlayheadInSpread(
  ctx: CanvasRenderingContext2D,
  dl: DisplayList,
  pos: PlayheadPosition,
  staves: StaffInfo[],
  viewMode: ViewMode,
  color: string | undefined,
): PlayheadRect | null {
  if (!dl.measureBounds || !dl.pages) return null;
  const engineX = beatToX(pos, dl.measureBounds);
  if (engineX === null) return null;

  const bounds =
    dl.measureBounds.find((b) => b.index === pos.measureIndex && b.partIndex === 0) ??
    dl.measureBounds.find((b) => b.index === pos.measureIndex);
  if (!bounds) return null;

  const page = findPageForY(dl.pages, bounds.y);
  if (!page) return null;
  const pageIndex = page.index;
  const nextPage = dl.pages[pageIndex + 1];
  const pageYEnd = nextPage ? nextPage.yOffset : Number.POSITIVE_INFINITY;

  // Restrict to the cursor's system by its (globally unique) systemIndex.
  // This isolates the system precisely and is immune to page overflow, so a
  // tall orchestral system whose lower staves extend past the next page's
  // yOffset still spans its full height. It supersedes the page filter inside
  // findSystemYExtent (see its doc comment).
  let systemYRange: { yTop: number; yBottom: number } | undefined;
  if (bounds.systemIndex !== undefined) {
    const sysIdx = bounds.systemIndex;
    let yTop = Number.POSITIVE_INFINITY;
    let yBottom = Number.NEGATIVE_INFINITY;
    for (const b of dl.measureBounds) {
      if (b.systemIndex === sysIdx) {
        if (b.y < yTop) yTop = b.y;
        if (b.y + b.height > yBottom) yBottom = b.y + b.height;
      }
    }
    if (Number.isFinite(yTop) && Number.isFinite(yBottom)) {
      systemYRange = { yTop, yBottom };
    }
  }

  // Find engine Y from staves. The page range is a fallback disambiguator used
  // only when no systemYRange is available.
  const extent = findSystemYExtent(staves, engineX, { yOffset: page.yOffset, yEnd: pageYEnd }, systemYRange);
  if (!extent) return null;

  const spreadPositions = computeSpreadPositions(viewMode, dl.pages, dl.width);
  const spreadPos = spreadPositions[pageIndex]!;
  const pageLayout = dl.pages[pageIndex]!;
  const dx = spreadPos.x;
  const dy = spreadPos.y - pageLayout.yOffset;

  const x = engineX + dx;
  const yTop = extent.yTop + dy;
  const yBottom = extent.yBottom + dy;
  paintPlayhead(ctx, x, yTop, yBottom, color);
  return { x, yTop, yBottom };
}

/**
 * Compute per-page (x,y) offsets for spread (vertical) or spread-h
 * (horizontal) layouts. Must mirror `computePagePlacements` in the editor's
 * `ScoreCanvas/viewportGeometry.ts` (the single source of truth).
 */
function computeSpreadPositions(
  viewMode: ViewMode,
  pages: DisplayList["pages"] & object,
  pageW: number,
): Array<{ x: number; y: number }> {
  if (viewMode === "spread-h") {
    return computeSpreadHPositions(pages, pageW);
  }
  return computeSpreadVPositions(pages, pageW);
}

function computeSpreadHPositions(pages: DisplayList["pages"] & object, pageW: number): Array<{ x: number; y: number }> {
  const spreadW = pageW * 2 + SPREAD_GAP;
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pages.length; i++) {
    if (i === 0) {
      result.push({ x: pageW + SPREAD_GAP, y: 0 });
    } else if (i % 2 === 1) {
      const spreadIdx = Math.ceil(i / 2);
      result.push({ x: spreadIdx * (spreadW + SPREAD_TURN_GAP), y: 0 });
    } else {
      const spreadIdx = i / 2;
      result.push({
        x: spreadIdx * (spreadW + SPREAD_TURN_GAP) + pageW + SPREAD_GAP,
        y: 0,
      });
    }
  }
  return result;
}

function computeSpreadVPositions(pages: DisplayList["pages"] & object, pageW: number): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  let rowY = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    if (i === 0) {
      result.push({ x: pageW + SPREAD_GAP, y: rowY });
      rowY += page.height + SPREAD_ROW_GAP;
    } else if (i % 2 === 1) {
      result.push({ x: 0, y: rowY });
    } else {
      result.push({ x: pageW + SPREAD_GAP, y: rowY });
      rowY += page.height + SPREAD_ROW_GAP;
    }
  }
  return result;
}

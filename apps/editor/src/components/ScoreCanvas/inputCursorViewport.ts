import type { Score } from "@viritura/core";
import { SpatialIndex, type DisplayList } from "@viritura/renderer";
import type { CursorPosition } from "../../store/noteInputStore";
import type { ViewportState } from "../../viewport";
import { buildBeatMap, mapEnginePointToViewport } from "../inputCursorHelpers";

const HORIZONTAL_TARGET_FRACTION = 0.15;
const VERTICAL_TARGET_FRACTION = 0.5;
const EMPTY_SPATIAL_INDEX = new SpatialIndex([]);

export interface ViewportSafeArea {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface InputCursorViewportTarget {
  x: number;
  y: number;
}

function interpolateBeatX(beat: number, anchors: Array<{ beat: number; x: number }>): number {
  if (beat <= anchors[0]!.beat) return anchors[0]!.x;
  const last = anchors[anchors.length - 1]!;
  if (beat >= last.beat) return last.x;
  for (let index = 0; index < anchors.length - 1; index++) {
    const start = anchors[index]!;
    const end = anchors[index + 1]!;
    if (beat >= start.beat && beat <= end.beat) {
      const fraction = end.beat === start.beat ? 0 : (beat - start.beat) / (end.beat - start.beat);
      return start.x + (end.x - start.x) * fraction;
    }
  }
  return last.x;
}

export function resolveInputCursorViewportTarget(
  cursor: CursorPosition,
  score: Score,
  displayList: DisplayList,
  voice: number,
  viewMode: "page" | "spread" | "spread-h" | "horizon",
): InputCursorViewportTarget | null {
  const beatMap = buildBeatMap(
    cursor.measureIndex,
    score,
    EMPTY_SPATIAL_INDEX,
    voice - 1,
    displayList,
    cursor.partIndex,
  );
  if (!beatMap || beatMap.anchors.length === 0) return null;

  const staffBounds = displayList.measureBounds
    ?.filter((bound) => bound.index === cursor.measureIndex && bound.partIndex === cursor.partIndex)
    .sort((left, right) => left.y - right.y);
  if (!staffBounds?.length) return null;
  const bounds = staffBounds[Math.min(cursor.staffIndex ?? 0, staffBounds.length - 1)]!;
  const beat = Math.min(Math.max(0, cursor.beatPosition), beatMap.totalBeats);
  const engineTarget = {
    x: interpolateBeatX(beat, beatMap.anchors),
    y: bounds.y + bounds.height / 2,
  };

  return mapEnginePointToViewport(engineTarget, displayList, viewMode);
}

export function computeInputCursorRecovery(
  target: InputCursorViewportTarget,
  viewport: ViewportState,
  viewportWidth: number,
  viewportHeight: number,
  safeArea: ViewportSafeArea | undefined,
): { x: number; y: number } | null {
  const leftInset = Math.max(0, safeArea?.left ?? 0);
  const topInset = Math.max(0, safeArea?.top ?? 0);
  const rightInset = Math.max(0, safeArea?.right ?? 0);
  const bottomInset = Math.max(0, safeArea?.bottom ?? 0);
  const usableWidth = Math.max(0, viewportWidth - leftInset - rightInset);
  const usableHeight = Math.max(0, viewportHeight - topInset - bottomInset);
  if (usableWidth === 0 || usableHeight === 0) return null;

  const visibleLeft = viewport.scrollX + leftInset / viewport.zoom;
  const visibleRight = viewport.scrollX + (viewportWidth - rightInset) / viewport.zoom;
  const visibleTop = viewport.scrollY + topInset / viewport.zoom;
  const visibleBottom = viewport.scrollY + (viewportHeight - bottomInset) / viewport.zoom;
  const overflowsHorizontally = target.x < visibleLeft || target.x > visibleRight;
  const overflowsVertically = target.y < visibleTop || target.y > visibleBottom;
  if (!overflowsHorizontally && !overflowsVertically) return null;

  return {
    x: overflowsHorizontally
      ? target.x - (leftInset + usableWidth * HORIZONTAL_TARGET_FRACTION) / viewport.zoom
      : viewport.scrollX,
    y: overflowsVertically
      ? target.y - (topInset + usableHeight * VERTICAL_TARGET_FRACTION) / viewport.zoom
      : viewport.scrollY,
  };
}

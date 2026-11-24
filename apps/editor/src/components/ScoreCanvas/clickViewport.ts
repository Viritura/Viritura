import { beatToX, type DisplayList, type PlayheadPosition } from "@viritura/renderer";
import type { WriteViewMode } from "@viritura/ui";
import { scorePageFrame } from "./imperativeHandle";

interface ClickViewportArgs {
  displayList: DisplayList;
  position: PlayheadPosition;
  page: number | undefined;
  viewMode: WriteViewMode;
  viewport: { scrollX: number; scrollY: number; zoom: number };
  width: number;
  height: number;
  safeArea?: { left?: number; top?: number; right?: number; bottom?: number };
}

export function clickFrameClip(
  frame: { width: number; height: number } | null,
  width: number,
  height: number,
  zoom: number,
  safeArea?: ClickViewportArgs["safeArea"],
): string {
  const left = safeArea?.left ?? 0;
  const right = safeArea?.right ?? 0;
  const top = safeArea?.top ?? 0;
  const bottom = safeArea?.bottom ?? 0;
  const extraX = frame ? Math.max(0, (width - left - right - frame.width * zoom) / 2) : 0;
  const extraY = frame ? Math.max(0, (height - top - bottom - frame.height * zoom) / 2) : 0;
  return `inset(${top + extraY}px ${right + extraX}px ${bottom + extraY}px ${left + extraX}px)`;
}

export function clickFollowScroll({
  displayList,
  position,
  page,
  viewMode,
  viewport,
  width,
  height,
  safeArea,
}: ClickViewportArgs): { x: number; y: number } | null {
  const left = safeArea?.left ?? 0;
  const top = safeArea?.top ?? 0;
  const usableWidth = Math.max(1, width - left - (safeArea?.right ?? 0));
  const usableHeight = Math.max(1, height - top - (safeArea?.bottom ?? 0));
  const { zoom, scrollX, scrollY } = viewport;
  if (viewMode !== "horizon") {
    const frame = page === undefined ? null : scorePageFrame(displayList, viewMode, page);
    if (!frame) return null;
    return {
      x: frame.x + frame.width / 2 - (left + usableWidth / 2) / zoom,
      y: frame.y + frame.height / 2 - (top + usableHeight / 2) / zoom,
    };
  }
  const bounds = displayList.measureBounds?.find((bound) => bound.index === position.measureIndex);
  const x = displayList.measureBounds && beatToX(position, displayList.measureBounds);
  if (!bounds || x == null) return null;
  const y = bounds.y + bounds.height / 2;
  return {
    x:
      x < scrollX + left / zoom || x > scrollX + (left + usableWidth) / zoom
        ? x - (left + usableWidth / 3) / zoom
        : scrollX,
    y:
      y < scrollY + top / zoom || y > scrollY + (top + usableHeight) / zoom
        ? y - (top + usableHeight / 2) / zoom
        : scrollY,
  };
}

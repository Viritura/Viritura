import type { ScoreViewMode } from "./types";

export function fitZoom(
  mode: "fit-width" | "fit-page",
  viewport: { readonly width: number; readonly height: number },
  page: { readonly width: number; readonly height: number },
  viewMode: ScoreViewMode,
  gap: number,
): number {
  const usableWidth = Math.max(1, viewport.width - 48);
  const usableHeight = Math.max(1, viewport.height - 48);
  const spread = viewMode === "spread" || viewMode === "spread-horizontal";
  const width = page.width * (spread ? 2 : 1) + (spread ? gap : 0);
  const widthZoom = usableWidth / Math.max(1, width);
  return mode === "fit-page" ? Math.min(widthZoom, usableHeight / Math.max(1, page.height)) : widthZoom;
}

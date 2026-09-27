import type {
  ScoreArrangement,
  ScoreContentAlign,
  ScorePagePosition,
  ScoreSpreadFirstPage,
  ScoreViewMode,
} from "./types";

export interface ArrangePagesOptions {
  readonly pages: readonly { readonly width: number; readonly height: number; readonly offsetY: number }[];
  readonly zoom: number;
  readonly gap: number;
  readonly viewMode: ScoreViewMode;
  readonly pagesPerRow?: number;
  readonly spreadFirstPage?: ScoreSpreadFirstPage;
}

export function arrangePages(options: ArrangePagesOptions): ScoreArrangement {
  const { pages, zoom, gap, viewMode } = options;
  const width = Math.max(0, ...pages.map((page) => page.width)) * zoom;
  const heights = pages.map((page) => page.height * zoom);
  let positions: ScorePagePosition[];
  if (viewMode === "horizon") {
    positions = pages.map((page, index) => ({
      page: index,
      x: 0,
      y: page.offsetY * zoom,
      width: page.width * zoom,
      height: page.height * zoom,
    }));
  } else if (viewMode === "horizontal") {
    positions = heights.map((height, index) => ({
      page: index,
      x: index * (width + gap),
      y: 0,
      width,
      height,
    }));
  } else if (viewMode === "spread" || viewMode === "spread-horizontal") {
    positions = arrangeSpreads(
      heights,
      width,
      gap,
      options.spreadFirstPage ?? "single",
      viewMode === "spread-horizontal",
    );
  } else {
    const columns = Math.max(1, Math.floor(options.pagesPerRow ?? 1));
    const rows: number[] = [];
    heights.forEach((height, index) => {
      const row = Math.floor(index / columns);
      rows[row] = Math.max(rows[row] ?? 0, height);
    });
    const offsets: number[] = [];
    let y = 0;
    for (const height of rows) {
      offsets.push(y);
      y += height + gap;
    }
    positions = heights.map((height, index) => ({
      page: index,
      x: (index % columns) * (width + gap),
      y: offsets[Math.floor(index / columns)] ?? 0,
      width,
      height,
    }));
  }
  return {
    positions,
    width: Math.max(0, ...positions.map((position) => position.x + position.width)),
    height: Math.max(0, ...positions.map((position) => position.y + position.height)),
  };
}

function arrangeSpreads(
  heights: readonly number[],
  width: number,
  gap: number,
  first: ScoreSpreadFirstPage,
  horizontal: boolean,
): ScorePagePosition[] {
  const positions: ScorePagePosition[] = [];
  const spreadWidth = width * 2 + gap;
  let x = 0;
  let y = 0;
  let index = 0;
  const place = (indices: readonly number[]) => {
    const offset = indices.length === 1 ? (spreadWidth - width) / 2 : 0;
    indices.forEach((page, column) => {
      positions[page] = { page, x: x + offset + column * (width + gap), y, width, height: heights[page] ?? 0 };
    });
    if (horizontal) x += spreadWidth + gap;
    else y += Math.max(...indices.map((page) => heights[page] ?? 0)) + gap;
  };
  if (first === "single" && heights.length) {
    place([0]);
    index = 1;
  }
  while (index < heights.length) {
    place(index + 1 < heights.length ? [index, index + 1] : [index]);
    index += 2;
  }
  return positions;
}

/** Offset that places content inside the viewport's inner box; oversized axes stay at the start so they scroll. */
export function contentOffset(
  align: ScoreContentAlign | undefined,
  viewport: { readonly width: number; readonly height: number },
  content: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  if (align !== "center") return { x: 0, y: 0 };
  return {
    x: Math.max(0, (viewport.width - content.width) / 2),
    y: Math.max(0, (viewport.height - content.height) / 2),
  };
}

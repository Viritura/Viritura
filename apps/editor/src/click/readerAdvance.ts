import type { MeasureGeometry, PlayheadGeometry, ScoreViewMode, SystemGeometry } from "@viritura/score-viewer-react";

export interface ReaderAdvance {
  readonly sourcePage: number;
  readonly targetPage: number;
  readonly fraction: number;
}

export function readerAdvance(
  mode: ScoreViewMode,
  position: Pick<PlayheadGeometry, "page" | "systemIndex">,
  measureIndex: number,
  measures: readonly MeasureGeometry[],
  systems: readonly SystemGeometry[],
  pageHeights: readonly number[],
): ReaderAdvance | undefined {
  const page = position.page;
  if (pageHeights[page + 1] === undefined) return undefined;
  if (mode === "spread" || mode === "spread-horizontal") {
    if (page === 0 || page % 2 !== 0) return undefined;
    const bars = [...new Set(measures.filter((measure) => measure.page === page).map((measure) => measure.index))].sort(
      (a, b) => a - b,
    );
    const current = bars.indexOf(measureIndex);
    if (current < Math.floor(bars.length / 2)) return undefined;
    return { sourcePage: page + 1, targetPage: page - 1, fraction: 1 };
  }
  if (mode !== "page") return undefined;
  const last = systems.filter((system) => system.page === page).at(-1);
  if (!last || position.systemIndex !== last.index || last.y < pageHeights[page]! / 2) return undefined;
  return { sourcePage: page + 1, targetPage: page, fraction: 0.5 };
}

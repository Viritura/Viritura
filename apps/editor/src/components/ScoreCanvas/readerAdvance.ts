export type ReaderViewMode = "page" | "spread" | "spread-h" | "horizon";

export interface ReaderMeasure {
  readonly index: number;
  readonly page: number;
  readonly systemIndex: number;
}

export interface ReaderSystem {
  readonly index: number;
  readonly page: number;
  readonly y: number;
  readonly height: number;
}

export interface ReaderAdvance {
  readonly sourcePage: number;
  readonly targetPage: number;
  readonly fraction: number;
}

export function readerGeometry(displayList: DisplayList): { measures: ReaderMeasure[]; systems: ReaderSystem[] } {
  const pages = displayList.pages ?? [];
  const pageBySystem = new Map<number, number>();
  pages.forEach((page, pageIndex) => {
    page.systemIndices.forEach((systemIndex) => pageBySystem.set(systemIndex, pageIndex));
  });
  const measures = new Map<string, ReaderMeasure>();
  const systems = new Map<number, ReaderSystem>();
  for (const bound of displayList.measureBounds ?? []) {
    const systemIndex = bound.systemIndex;
    if (systemIndex === undefined) continue;
    const page = pageBySystem.get(systemIndex);
    if (page === undefined) continue;
    const measure = { index: bound.index, page, systemIndex };
    measures.set(`${measure.index}:${page}:${systemIndex}`, measure);
    const current = systems.get(systemIndex);
    const y = bound.y - pages[page]!.yOffset;
    const top = current ? Math.min(current.y, y) : y;
    const bottom = current ? Math.max(current.y + current.height, y + bound.height) : y + bound.height;
    systems.set(systemIndex, { index: systemIndex, page, y: top, height: bottom - top });
  }
  return { measures: [...measures.values()], systems: [...systems.values()] };
}

export function readerAdvance(
  mode: ReaderViewMode,
  position: { readonly page: number; readonly systemIndex: number },
  measureIndex: number,
  measures: readonly ReaderMeasure[],
  systems: readonly ReaderSystem[],
  pageHeights: readonly number[],
): ReaderAdvance | undefined {
  const page = position.page;
  if (pageHeights[page + 1] === undefined) return undefined;
  if (mode === "spread" || mode === "spread-h") {
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
import type { DisplayList } from "@viritura/renderer";

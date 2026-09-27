import type { LayoutOptions } from "@viritura/score-engine";
import type { ScoreViewerOptions } from "./types";

/** Translate viewer presentation options into a score-engine layout request. */
export function layoutOptionsFor(options: ScoreViewerOptions): LayoutOptions {
  const horizon = options.viewMode === "horizon";
  const pageWidth = horizon ? 0 : (options.pageWidth ?? 800);
  const defaultMargin = pageWidth * (15 / 210);
  const margins = options.pageMargins ?? {
    top: defaultMargin,
    right: defaultMargin,
    bottom: defaultMargin,
    left: defaultMargin,
  };
  // A horizon strip has no page, but explicit margins still position the ink.
  const useSetup = !horizon || options.pageMargins !== undefined;
  const pageHeight = options.pageHeight ?? (options.pageWidth ?? 800) * (297 / 210);
  return {
    pageWidth,
    spatium: options.spatium ?? 7,
    scoreIndex: options.scoreIndex ?? 0,
    pageSetup: useSetup ? { height: pageHeight, margins: { ...margins } } : undefined,
  };
}

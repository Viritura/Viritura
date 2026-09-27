import type { ScoreViewerOptions } from "./types";

export function needsLayout(previous: ScoreViewerOptions, next: ScoreViewerOptions): boolean {
  return (
    previous.viewMode !== next.viewMode ||
    previous.pageWidth !== next.pageWidth ||
    previous.pageHeight !== next.pageHeight ||
    previous.pageMargins?.top !== next.pageMargins?.top ||
    previous.pageMargins?.right !== next.pageMargins?.right ||
    previous.pageMargins?.bottom !== next.pageMargins?.bottom ||
    previous.pageMargins?.left !== next.pageMargins?.left ||
    previous.spatium !== next.spatium ||
    previous.scoreIndex !== next.scoreIndex ||
    previous.useWorker !== next.useWorker ||
    previous.engine !== next.engine
  );
}

export function needsArrangement(previous: ScoreViewerOptions, next: ScoreViewerOptions): boolean {
  return (
    previous.zoom !== next.zoom ||
    previous.pageGap !== next.pageGap ||
    previous.pagesPerRow !== next.pagesPerRow ||
    previous.spreadFirstPage !== next.spreadFirstPage ||
    previous.ink !== next.ink ||
    previous.pageBackground !== next.pageBackground ||
    previous.contentAlign !== next.contentAlign
  );
}

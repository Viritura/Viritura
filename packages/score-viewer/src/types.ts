import type { DisplayList, Engine, PlayheadGeometry, ScoreMeasurements, ScorePosition } from "@viritura/score-engine";

export type ScoreViewMode = "page" | "horizontal" | "spread" | "spread-horizontal" | "horizon";
export type ScoreContentAlign = "start" | "center";
export type ScoreSpreadFirstPage = "single" | "paired";

export interface ScorePageMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ScorePagePosition {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScoreArrangement {
  readonly positions: readonly ScorePagePosition[];
  readonly width: number;
  readonly height: number;
}

export interface ScoreViewerOptions {
  engine?: Engine;
  assetBaseUrl?: string;
  textFont?: boolean;
  viewMode?: ScoreViewMode;
  pageWidth?: number;
  pageHeight?: number;
  pageMargins?: ScorePageMargins;
  spatium?: number;
  scoreIndex?: number;
  zoom?: number | "fit-width" | "fit-page";
  pageGap?: number;
  pagesPerRow?: number;
  spreadFirstPage?: ScoreSpreadFirstPage;
  pageBackground?: string;
  /** Where the score sits when it is smaller than the viewport. Default `"start"`. */
  contentAlign?: ScoreContentAlign;
  ink?: string;
  background?: string;
  playhead?: (ScorePosition & { readonly follow?: boolean }) | null;
  useWorker?: boolean;
  onReady?: (info: { engine: Engine; displayList: DisplayList }) => void;
  onLoading?: () => void;
  onLayout?: (measurements: ScoreMeasurements, arrangement: ScoreArrangement) => void;
  onError?: (error: Error) => void;
  onPaint?: () => void;
}

export interface ScoreViewerHandle {
  readonly engine: Engine | null;
  readonly displayList: DisplayList | null;
  readonly measurements: ScoreMeasurements | null;
  readonly arrangement: ScoreArrangement;
  readonly viewport: HTMLElement;
  readonly surface: HTMLElement;
  readonly zoom: number;
  update(mnx: string | object | null): void;
  setOptions(options: Partial<ScoreViewerOptions>): void;
  zoomTo(zoom: number | "fit-width" | "fit-page"): void;
  scrollToPosition(position: ScorePosition): void;
  playheadGeometry(): PlayheadGeometry | null;
  destroy(): void;
}

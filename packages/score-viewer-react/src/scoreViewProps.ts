import type { CSSProperties, ReactNode } from "react";
import type { DisplayList, Engine, EngineLoadError, LayoutError, ParseError } from "@viritura/score-engine";
import type { ScorePageMargins, ScoreSpreadFirstPage, ScoreViewMode } from "@viritura/score-viewer";

export interface ScoreViewProps {
  mnx: string | object;
  assetBaseUrl?: string;
  pageWidth?: number;
  pageHeight?: number;
  pageMargins?: ScorePageMargins;
  spatium?: number;
  scoreIndex?: number;
  viewMode?: ScoreViewMode;
  zoom?: number | "fit-width" | "fit-page";
  gap?: number;
  spreadFirstPage?: ScoreSpreadFirstPage;
  pagesPerRow?: number;
  onReady?: (info: { engine: Engine; displayList: DisplayList }) => void;
  onPaint?: (info: { engine: Engine; displayList: DisplayList }) => void;
  onError?: (error: EngineLoadError | ParseError | LayoutError) => void;
  className?: string;
  style?: CSSProperties;
  pageClassName?: string;
  pageStyle?: CSSProperties;
  pageBackground?: string;
  /** Remove viewport padding for embedded, cropped score fragments. */
  bare?: boolean;
  ink?: string;
  loadingFallback?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
  children?: ReactNode;
}

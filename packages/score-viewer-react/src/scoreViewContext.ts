import { createContext, useContext } from "react";
import type { DisplayList, Engine } from "@viritura/score-engine";
import type { ScorePagePosition, ScoreViewMode, ScoreViewerHandle } from "@viritura/score-viewer";

export interface ScoreViewContextValue {
  engine: Engine | null;
  displayList: DisplayList | null;
  zoom: number;
  pagePositions: readonly ScorePagePosition[];
  viewMode: ScoreViewMode;
  viewer: ScoreViewerHandle | null;
}

export const ScoreViewContext = createContext<ScoreViewContextValue | null>(null);

export function useScoreView(): ScoreViewContextValue {
  const value = useContext(ScoreViewContext);
  if (!value) throw new Error("useScoreView must be used inside <ScoreView>");
  return value;
}

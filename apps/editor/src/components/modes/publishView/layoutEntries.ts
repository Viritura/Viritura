import type { Score } from "@viritura/core";
import { resolvePageSetupForScore, getScoreDisplayName } from "../../../publish/batchRender";
import { layoutOverrides } from "../../../engraveStyle";

export interface LayoutEntry {
  index: number;
  name: string;
  pageSetup: ReturnType<typeof resolvePageSetupForScore>;
  /** Settings this layout customizes instead of following its profile and the house style. */
  customCount: number;
}

/** Build the layout cards displayed in the left panel for the given score. */
export function buildLayoutEntries(score: Score | null): LayoutEntry[] {
  if (!score?.scores) return [];
  return score.scores.map((_, i) => ({
    index: i,
    name: getScoreDisplayName(score, i),
    pageSetup: resolvePageSetupForScore(score, i),
    customCount: layoutOverrides(score, i).total,
  }));
}

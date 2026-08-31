import type { Score } from "@viritura/core";
import { resolvePageSetupForScore, getScoreDisplayName } from "../../../publish/batchRender";

export interface LayoutEntry {
  index: number;
  name: string;
  pageSetup: ReturnType<typeof resolvePageSetupForScore>;
  hasOverride: boolean;
}

/** Build the layout cards displayed in the left panel for the given score. */
export function buildLayoutEntries(score: Score | null): LayoutEntry[] {
  if (!score?.scores) return [];
  return score.scores.map((sd, i) => ({
    index: i,
    name: getScoreDisplayName(score, i),
    pageSetup: resolvePageSetupForScore(score, i),
    hasOverride: !!sd.pageSetup,
  }));
}

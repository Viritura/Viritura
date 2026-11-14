import type { Score } from "./score";
import { defaultPageSetupForScore, type PageSetup } from "./layout";

/** Project defaults are portable; user preferences are only copied when creating a document. */
export function resolveScorePageSetup(score: Score | null, scoreIndex: number): PageSetup {
  const defaults = defaultPageSetupForScore(
    score?.scores,
    scoreIndex,
    score?.layouts,
    score?.parts.length,
    score?.pageSetupDefaults,
  );
  const stored = score?.scores?.[scoreIndex]?.pageSetup;
  return {
    ...defaults,
    ...stored,
    margins: { ...defaults.margins, ...stored?.margins },
  };
}

import type { Score } from "./score";
import { defaultPageSetupForScore, type PageSetup, type PageTurnSettings } from "./layout";

function inheritPageTurns(defaults?: PageTurnSettings, stored?: PageTurnSettings): PageTurnSettings | undefined {
  if (!stored) return defaults;
  if (!defaults) return stored;
  return {
    ...defaults,
    ...stored,
    ...(defaults.weights || stored.weights ? { weights: { ...defaults.weights, ...stored.weights } } : {}),
  };
}

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
  const pageTurns = inheritPageTurns(defaults.pageTurns, stored?.pageTurns);
  return {
    ...defaults,
    ...stored,
    margins: { ...defaults.margins, ...stored?.margins },
    ...(pageTurns ? { pageTurns } : {}),
  };
}

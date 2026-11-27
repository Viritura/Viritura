import type { Score } from "./score";
import { defaultPageSetupForScore, type PageSetup, type PageTurnSettings } from "./layout";

const POINTS_PER_MM = 72 / 25.4;

/** Convert a staff-space font size to points for a page setup's staff size. */
export function staffSpacesToPoints(sizeSp: number, spatiumMm: number): number {
  return sizeSp * spatiumMm * POINTS_PER_MM;
}

/** Convert a point size back to the staff-space value stored in the score. */
export function pointsToStaffSpaces(sizePt: number, spatiumMm: number): number {
  return sizePt / (spatiumMm * POINTS_PER_MM);
}

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

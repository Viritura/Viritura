import {
  resolvePageTurnSettings,
  type PageTurnSettings,
  type PageTurnWeightSettings,
  type ResolvedPageTurnSettings,
  type Score,
} from "@viritura/core";
import { readPageLayer, resolvedPageSetup, writePageLayer, type PageScope } from "./pageScope";

type TopLevelKey = Exclude<keyof ResolvedPageTurnSettings, "weights">;

function changedWeights(
  before: ResolvedPageTurnSettings["weights"],
  after: ResolvedPageTurnSettings["weights"],
): PageTurnWeightSettings {
  const keys = Object.keys(after) as (keyof ResolvedPageTurnSettings["weights"])[];
  return Object.fromEntries(keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]));
}

/**
 * Apply a page-turn edit to one profile or layout, storing only the values that
 * changed so the rest keeps following the parent layer. `enabled` is required
 * by the format, so every stored page-turn layer pins it.
 */
export function updatePageTurns(
  score: Score,
  scope: PageScope,
  update: (current: ResolvedPageTurnSettings) => ResolvedPageTurnSettings,
): Score {
  const before = resolvePageTurnSettings(resolvedPageSetup(score, scope).pageTurns);
  const after = update(before);
  const keys = Object.keys(after).filter((key) => key !== "weights") as TopLevelKey[];
  const changed = Object.fromEntries(keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]));
  const weights = changedWeights(before.weights, after.weights);
  if (!Object.keys(changed).length && !Object.keys(weights).length) return score;
  const layer = readPageLayer(score, scope);
  const stored = layer?.pageTurns;
  const mergedWeights = { ...stored?.weights, ...weights };
  const pageTurns: PageTurnSettings = {
    ...stored,
    ...changed,
    enabled: after.enabled,
    ...(Object.keys(mergedWeights).length ? { weights: mergedWeights } : {}),
  };
  return writePageLayer(score, scope, { ...layer, pageTurns });
}

/**
 * scoreDefHelpers — tiny shared utilities used by both the main score-def
 * mutations (pagination, breaks) and the staff-visibility mutations. Lives
 * in its own file to avoid a circular import between the two consumers.
 */

import type { Score, ScoreDefinition } from "@viritura/core";

/** Stable measure-id order for a Score, falling back to `m{n}` when ids are missing. */
export function measureOrder(score: Score): string[] {
  return score.global.measures.map((m, i) => m.id ?? `m${i + 1}`);
}

/**
 * Functional update of `score.scores[scoreIndex]` that returns a new Score.
 * No-op when `scoreIndex` is out of range.
 */
export function withScoreDef(
  score: Score,
  scoreIndex: number,
  update: (sd: ScoreDefinition) => ScoreDefinition,
): Score {
  if (!score.scores || scoreIndex < 0 || scoreIndex >= score.scores.length) {
    return score;
  }
  const next = score.scores.slice();
  next[scoreIndex] = update(next[scoreIndex]!);
  return { ...score, scores: next };
}

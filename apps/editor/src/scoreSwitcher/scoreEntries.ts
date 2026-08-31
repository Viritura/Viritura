/**
 * scoreEntries — the score list that feeds the header switcher.
 *
 * Splits a document's definitions into **scores** (more than one source part)
 * and **parts** (one source part, even when it uses multiple staves). That distinction is derived, not
 * stored: see `docs/guide/instruments-and-scores.md`. A 30-instrument
 * orchestra produces ~30 part extracts, so an ungrouped flat list would be
 * unusable in a dropdown.
 */
import type { Score } from "@viritura/core";
import { getScoreDisplayName } from "../publish/batchRender";
import { collectPartIdsInLayout } from "../score/scoreMembership";

export interface ScoreEntry {
  readonly index: number;
  readonly name: string;
  /** Multi-part definitions are scores; one-part definitions are part extracts. */
  readonly isScore: boolean;
}

export function buildScoreEntries(score: Score | null): ScoreEntry[] {
  if (!score?.scores) return [];
  const layouts = score.layouts ?? [];
  return score.scores.map((sd, index) => {
    const layout = sd.layout ? layouts.find((l) => l.id === sd.layout) : undefined;
    const partCount = layout ? collectPartIdsInLayout(layout.content).size : 0;
    return { index, name: getScoreDisplayName(score, index), isScore: partCount > 1 };
  });
}

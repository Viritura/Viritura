import type { Score } from "@viritura/core";

export interface JumpBarNavigationTarget {
  measureIndex: number;
  label: string;
}

function measureNumberAt(score: Score, measureIndex: number): number {
  return score.global.measures[measureIndex]?.number ?? measureIndex + 1;
}

/** Resolve compact Jump Bar navigation syntax without polluting the command catalog. */
export function resolveJumpBarNavigationQuery(query: string, score: Score | null): JumpBarNavigationTarget | null {
  if (!score) return null;
  const trimmed = query.trim();
  const measureMatch = trimmed.match(/^[bm]\s*(\d+)$/i);
  if (measureMatch) {
    const requested = Number(measureMatch[1]);
    if (!Number.isSafeInteger(requested) || requested < 1) return null;
    const measureIndex = score.global.measures.findIndex((_, index) => measureNumberAt(score, index) === requested);
    return measureIndex >= 0 ? { measureIndex, label: `Go to measure ${requested}` } : null;
  }

  const rehearsalMatch = trimmed.match(/^r\s*(.+)$/i);
  if (!rehearsalMatch) return null;
  const requested = rehearsalMatch[1]!.trim();
  if (!requested) return null;
  const measureIndex = score.global.measures.findIndex(
    (measure) => measure.rehearsalMark?.text.trim().toLocaleLowerCase() === requested.toLocaleLowerCase(),
  );
  if (measureIndex < 0) return null;
  return {
    measureIndex,
    label: `Go to rehearsal ${score.global.measures[measureIndex]!.rehearsalMark!.text}`,
  };
}

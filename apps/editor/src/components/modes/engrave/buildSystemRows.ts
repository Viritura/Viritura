import { extractSnapshot, type Score } from "@viritura/core";
import { hiddenPartsOnSystem } from "../../../score/ScoreMutations";

export interface SystemRow {
  measure: string;
  measureNumber?: number;
  /** Number of the measure immediately before `measure`. Undefined for m. 1
   *  (the implicit start of the score, not an authored break). */
  previousMeasureNumber?: number;
  pageBreak: boolean;
  isAuthored: boolean;
  hiddenParts: Set<string>;
}

export function buildSystemRows(score: Score, scoreIndex: number): SystemRow[] {
  const sd = score.scores?.[scoreIndex];
  if (!sd) return [];
  const snap = extractSnapshot(sd);

  const measureNumberById = new Map<string, number>();
  const indexById = new Map<string, number>();
  score.global.measures.forEach((m, i) => {
    if (m.id) {
      measureNumberById.set(m.id, m.number ?? i + 1);
      indexById.set(m.id, i);
    }
  });

  const previousNumberFor = (measureId: string): number | undefined => {
    const i = indexById.get(measureId);
    if (i === undefined || i <= 0) return undefined;
    const prev = score.global.measures[i - 1]!;
    return prev.number ?? i;
  };

  if (snap.entries.length === 0) {
    const first = score.global.measures[0];
    if (!first?.id) return [];
    return [
      {
        measure: first.id,
        measureNumber: first.number ?? 1,
        previousMeasureNumber: undefined,
        pageBreak: false,
        isAuthored: false,
        hiddenParts: new Set(),
      },
    ];
  }

  return snap.entries.map((e) => ({
    measure: e.measure,
    measureNumber: measureNumberById.get(e.measure),
    previousMeasureNumber: previousNumberFor(e.measure),
    pageBreak: e.pageBreak,
    // The implicit first system (starting at m. 1) is not really an authored
    // break even when present in the snapshot — there's no "after m. 0".
    isAuthored: previousNumberFor(e.measure) !== undefined,
    hiddenParts: hiddenPartsOnSystem(score, scoreIndex, e.measure),
  }));
}

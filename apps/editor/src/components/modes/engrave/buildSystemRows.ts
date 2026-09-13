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

  const rowsByMeasure = new Map<string, SystemRow>();
  for (const entry of snap.entries) {
    rowsByMeasure.set(entry.measure, {
      measure: entry.measure,
      measureNumber: measureNumberById.get(entry.measure),
      previousMeasureNumber: previousNumberFor(entry.measure),
      pageBreak: entry.pageBreak,
      isAuthored: previousNumberFor(entry.measure) !== undefined,
      hiddenParts: hiddenPartsOnSystem(score, scoreIndex, entry.measure),
    });
  }
  for (const entry of sd.layoutBreaks ?? []) {
    rowsByMeasure.set(entry.measure, {
      measure: entry.measure,
      measureNumber: measureNumberById.get(entry.measure),
      previousMeasureNumber: previousNumberFor(entry.measure),
      pageBreak: entry.kind === "page",
      isAuthored: true,
      hiddenParts: rowsByMeasure.get(entry.measure)?.hiddenParts ?? new Set(),
    });
  }

  if (rowsByMeasure.size === 0) {
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

  return [...rowsByMeasure.values()].sort(
    (left, right) => (indexById.get(left.measure) ?? Infinity) - (indexById.get(right.measure) ?? Infinity),
  );
}

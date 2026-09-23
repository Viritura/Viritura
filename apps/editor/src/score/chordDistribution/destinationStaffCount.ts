import type { Score } from "@viritura/core";
import type { MeasureSelectionPoint, Selection } from "../../store/selectionStore";

function partStaffCount(score: Score, partIndex: number): number {
  const part = score.parts[partIndex];
  if (!part) return 1;
  return Math.max(
    part.staves ?? 1,
    ...part.measures.flatMap((measure) => measure.sequences.map((sequence) => sequence.staff ?? 1)),
  );
}

function staffOrdinal(score: Score, partIndex: number, localStaffIndex: number): number {
  let ordinal = localStaffIndex;
  for (let index = 0; index < partIndex; index++) ordinal += partStaffCount(score, index);
  return ordinal;
}

function pointOrdinal(score: Score, point: MeasureSelectionPoint): number {
  return staffOrdinal(score, point.partIndex, point.localStaffIndex ?? 0);
}

function spanCount(start: number, end: number): number | undefined {
  const count = Math.abs(end - start) + 1;
  return count > 1 ? count : undefined;
}

/**
 * Return an explicit multi-staff destination span. A single-staff target leaves
 * Explode free to choose the fragment's maximum simultaneity.
 */
export function destinationStaffCount(score: Score, selection: Selection): number | undefined {
  if (selection.kind === "measure") {
    const start = staffOrdinal(score, selection.startPartIndex, selection.startLocalStaffIndex ?? 0);
    const end = staffOrdinal(score, selection.endPartIndex, selection.endLocalStaffIndex ?? 0);
    return spanCount(start, end);
  }
  if (selection.kind === "range" && selection.measureAnchor && selection.measureFocus) {
    return spanCount(pointOrdinal(score, selection.measureAnchor), pointOrdinal(score, selection.measureFocus));
  }
  return undefined;
}

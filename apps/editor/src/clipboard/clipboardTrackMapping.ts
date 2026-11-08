import type { Score } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";

export function measureSelectionStaffOffsets(
  score: Score,
  selection: Extract<SelectionState, { kind: "measure" }>,
): { start: number; end: number } | undefined {
  if (selection.startLocalStaffIndex === undefined || selection.endLocalStaffIndex === undefined) return undefined;
  const startPart = Math.min(selection.startPartIndex, selection.endPartIndex);
  const anchor = partStaffOffset(score, startPart, selection.startPartIndex, selection.startLocalStaffIndex + 1);
  const focus = partStaffOffset(score, startPart, selection.endPartIndex, selection.endLocalStaffIndex + 1);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

export function selectionStaffAnchor(
  score: Score,
  locations: readonly EventLocation[],
): {
  partIndex: number;
  staffOffset: number;
} {
  const partIndex = Math.min(...locations.map((location) => location.partIndex));
  const staffOffset = Math.min(
    ...locations.map((location) => {
      const staff =
        score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex]?.staff ?? 1;
      return partStaffOffset(score, partIndex, location.partIndex, staff);
    }),
  );
  return { partIndex, staffOffset };
}

interface PhysicalTrackReference {
  partOffset: number;
  measureIndex: number;
  voiceIndex: number;
}

export function firstPhysicalTrack<T extends PhysicalTrackReference>(
  score: Score,
  firstPartIndex: number,
  tracks: readonly T[],
): T {
  return tracks.reduce((current, candidate) => {
    if (candidate.partOffset !== current.partOffset) {
      return candidate.partOffset < current.partOffset ? candidate : current;
    }
    const candidateStaff =
      score.parts[firstPartIndex + candidate.partOffset]?.measures[candidate.measureIndex]?.sequences[
        candidate.voiceIndex
      ]?.staff ?? 1;
    const currentStaff =
      score.parts[firstPartIndex + current.partOffset]?.measures[current.measureIndex]?.sequences[current.voiceIndex]
        ?.staff ?? 1;
    return candidateStaff < currentStaff ? candidate : current;
  });
}

export function partStaffOffset(score: Score, startPart: number, partIndex: number, staff: number): number {
  let result = Math.max(0, staff - 1);
  for (let index = Math.min(startPart, partIndex); index < Math.max(startPart, partIndex); index++) {
    result += Math.sign(partIndex - startPart) * Math.max(1, score.parts[index]?.staves ?? 1);
  }
  return result;
}

export function voiceIndexWithinStaff(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
): number {
  const sequences = score.parts[partIndex]?.measures[measureIndex]?.sequences ?? [];
  const staff = sequences[sequenceIndex]?.staff ?? 1;
  return sequences.slice(0, sequenceIndex).filter((sequence) => (sequence.staff ?? 1) === staff).length;
}

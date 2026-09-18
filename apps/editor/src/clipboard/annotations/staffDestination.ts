import type { Score } from "@viritura/core";
import type { ClipboardTrack } from "../ClipboardFragment";

export function resolvePhysicalStaffDestination(
  score: Score,
  partIndex: number,
  staffIndex: number,
  offset: number,
): { partIndex: number; staffIndex: number } {
  if (!Number.isInteger(offset)) throw new Error("Invalid clipboard staff offset.");
  let remaining = score.parts.slice(0, partIndex).reduce((sum, part) => sum + Math.max(1, part.staves ?? 1), 0);
  remaining += staffIndex + offset;
  if (remaining < 0) throw new Error("Clipboard staff is above the destination score.");
  for (let currentPart = 0; currentPart < score.parts.length; currentPart++) {
    const count = Math.max(1, score.parts[currentPart]?.staves ?? 1);
    if (remaining < count) return { partIndex: currentPart, staffIndex: remaining };
    remaining -= count;
  }
  throw new Error("MuseScore clipboard contains more physical staves than the destination score.");
}

function sourcePartOrigin(tracks: readonly ClipboardTrack[], sourcePartOffset: number): number | undefined {
  const candidates = tracks.filter((track) => track.partOffset === sourcePartOffset && track.staffOffset !== undefined);
  if (candidates.length === 0) return undefined;
  const origins = new Set<number>();
  for (const track of candidates) {
    // Older track-bound dynamics can supply a source coordinate; the number of
    // annotations or copied staves cannot identify a part's missing upper staves.
    const sourceStaves =
      track.sourceStaff === undefined
        ? (track.dynamics ?? []).map((item) => item.dynamic.staff ?? 1)
        : [track.sourceStaff];
    for (const staff of sourceStaves) {
      if (!Number.isInteger(staff) || staff < 1) throw new Error("Invalid clipboard source staff.");
      origins.add(track.staffOffset! - staff + 1);
    }
  }
  if (origins.size !== 1) throw new Error("Clipboard annotation source staff is ambiguous. Copy the selection again.");
  return [...origins][0]!;
}

export function capturedAnnotationDestination(
  score: Score,
  partIndex: number,
  anchorStaffIndex: number,
  tracks: ClipboardTrack[] | undefined,
  sourcePartOffset: number,
  sourceStaff: number,
  staffOffset?: number,
): { partIndex: number; staff?: number } {
  if (staffOffset === undefined) {
    const origin = sourcePartOrigin(tracks ?? [], sourcePartOffset);
    if (origin === undefined) return { partIndex: partIndex + sourcePartOffset };
    staffOffset = origin + sourceStaff - 1;
  }
  const destination = resolvePhysicalStaffDestination(score, partIndex, anchorStaffIndex, staffOffset);
  return { partIndex: destination.partIndex, staff: destination.staffIndex + 1 };
}

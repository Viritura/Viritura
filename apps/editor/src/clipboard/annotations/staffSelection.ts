import type { ClipboardTrack } from "../ClipboardFragment";
import type { SelectionTrackRhythmicRange } from "../../store/selectionStore";

export function annotationInTrackRanges(
  ranges: readonly SelectionTrackRhythmicRange[] | undefined,
  partIndex: number,
  staff: number,
  measureIndex: number,
  beat: number,
): boolean {
  return (
    ranges === undefined ||
    ranges.some(
      (range) =>
        range.partIndex === partIndex &&
        range.staff === staff &&
        (measureIndex > range.start.measureIndex ||
          (measureIndex === range.start.measureIndex && beat >= range.start.beat - 1e-9)) &&
        (measureIndex < range.end.measureIndex ||
          (measureIndex === range.end.measureIndex && beat < range.end.beat - 1e-9)),
    )
  );
}

export function sourceStavesForPart(tracks: readonly ClipboardTrack[], partOffset: number): ReadonlySet<number> {
  return new Set(
    tracks.flatMap((track) =>
      track.partOffset === partOffset && track.sourceStaff !== undefined ? [track.sourceStaff] : [],
    ),
  );
}

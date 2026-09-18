import type { ClipboardTrack } from "../ClipboardFragment";

export function sourceStavesForPart(tracks: readonly ClipboardTrack[], partOffset: number): ReadonlySet<number> {
  return new Set(
    tracks.flatMap((track) =>
      track.partOffset === partOffset && track.sourceStaff !== undefined ? [track.sourceStaff] : [],
    ),
  );
}

import type { CapturedDynamic, ClipboardTrack } from "../ClipboardFragment";

function identity(captured: CapturedDynamic, partOffset = 0): string {
  return `${captured.partOffset ?? partOffset}:${captured.dynamic.staff ?? 1}:${captured.measureOffset}:${captured.dynamic.id}`;
}

export function unassignedDynamics(
  dynamics: CapturedDynamic[] | undefined,
  tracks: readonly ClipboardTrack[],
): CapturedDynamic[] | undefined {
  const assigned = new Set(
    tracks.flatMap((track) => (track.dynamics ?? []).map((item) => identity(item, track.partOffset))),
  );
  return dynamics?.filter((item) => !assigned.has(identity(item)));
}

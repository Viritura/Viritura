import type { MidiTimeline } from "@viritura/audio";

export interface PendingPlaybackStart {
  seconds: number;
}

/** Never start an older engine timeline after score compilation has failed. */
export function requirePlayableTimeline(timeline: MidiTimeline | null): MidiTimeline {
  if (!timeline) throw new Error("No playable score timeline is available.");
  return timeline;
}

/** New seeks during preparation take precedence over the original request. */
export function resolveTransportStart(
  explicitSeconds: number | undefined,
  resumeAt: number,
  pendingAtRequest: PendingPlaybackStart | null,
  latestPending: PendingPlaybackStart | null,
): number {
  if (latestPending !== pendingAtRequest) return latestPending?.seconds ?? 0;
  return explicitSeconds ?? pendingAtRequest?.seconds ?? resumeAt;
}

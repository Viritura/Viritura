export interface PendingPlaybackStart {
  seconds: number;
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

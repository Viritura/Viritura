import { getVirituraApiBaseUrl } from "../config";

/**
 * URL helpers for the live-collaboration <c>#live=ROOMID</c> deep link.
 *
 * Format: <c>https://app.viritura.com/#live=abc12345abc12345</c>.
 * The room id is the bearer capability, so it lives in the fragment and is
 * never sent in an HTTP request target, Referer header, or access log.
 */

import { isValidRoomId } from "@viritura/crdt";

const LIVE_QUERY_PARAM = "live";
const LIVE_TRANSPORT_QUERY_PARAM = "live-transport";
const LIVE_SIGNALING_QUERY_PARAM = "live-signaling";

export function parseLiveRoomIdFromUrl(url: string = window.location.href): string | null {
  try {
    const parsed = new URL(url);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const candidate = fragment.get(LIVE_QUERY_PARAM) ?? parsed.searchParams.get(LIVE_QUERY_PARAM);
    if (!candidate) return null;
    return isValidRoomId(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Update the current page URL to include <c>?live=ROOMID</c>, preserving
 * all other query params. Uses <c>history.replaceState</c> so we don't
 * pollute the back-button history with the host-promotion event.
 */
export function setLiveRoomIdInUrl(roomId: string): void {
  try {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.set(LIVE_QUERY_PARAM, roomId);
    url.hash = fragment.toString();
    url.searchParams.delete(LIVE_QUERY_PARAM);
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* non-browser env */
  }
}

/** Remove the <c>?live=</c> param from the current URL. */
export function clearLiveRoomIdFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.delete(LIVE_QUERY_PARAM);
    url.hash = fragment.toString();
    url.searchParams.delete(LIVE_QUERY_PARAM);
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* non-browser env */
  }
}

/** Build the share URL for a given room id, based on the current origin. */
export function buildShareUrl(roomId: string): string {
  try {
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.set(LIVE_QUERY_PARAM, roomId);
    url.hash = fragment.toString();
    url.searchParams.delete(LIVE_QUERY_PARAM);
    return url.toString();
  } catch {
    return `#live=${roomId}`;
  }
}

/**
 * Read the transport override from <c>?live-transport=...</c>. Valid
 * values are <c>"webrtc"</c> (default) and <c>"broadcast-channel"</c>
 * (same-origin same-browser only — useful for multi-tab and for
 * deterministic E2E tests that can't depend on a reachable signaling
 * server).
 */
export function parseLiveTransportFromUrl(url: string = window.location.href): "webrtc" | "broadcast-channel" | null {
  try {
    const parsed = new URL(url);
    const candidate = parsed.searchParams.get(LIVE_TRANSPORT_QUERY_PARAM);
    if (candidate === "webrtc" || candidate === "broadcast-channel") return candidate;
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the signaling-server override list from
 * <c>?live-signaling=wss://a,wss://b</c>. Comma-separated list of WebSocket
 * URLs. Returns <c>null</c> when the param is absent or empty so callers
 * can fall back to {@link getDefaultSignalingUrls}.
 *
 * Use case: pointing dev / staging / E2E at a specific signaling host
 * without rebuilding. Production peers normally use the baked-in default.
 */
export function parseLiveSignalingFromUrl(url: string = window.location.href): readonly string[] | null {
  try {
    const parsed = new URL(url);
    const candidate = parsed.searchParams.get(LIVE_SIGNALING_QUERY_PARAM);
    if (!candidate) return null;
    const urls = candidate
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("ws://") || entry.startsWith("wss://"));
    return urls.length > 0 ? urls : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the signaling URL list the editor should use by default:
 * the y-webrtc relay hosted by our own Viritura API
 * (see <c>server/Viritura.Api/Signaling/SignalingEndpoint.cs</c>).
 *
 * The public free signaling servers Yjs used to ship are all dead, so
 * we host our own next to the auth API. The path matches the route
 * registered in <c>Program.cs</c>: <c>/live/signal</c>.
 */
export function getDefaultSignalingUrls(): readonly string[] {
  const apiBase = getVirituraApiBaseUrl();
  const wsBase = apiBase.replace(/^http/i, "ws").replace(/\/+$/, "");
  return [`${wsBase}/live/signal`];
}

/**
 * Build the HTTPS snapshot endpoint URL for a given room. Matches the
 * route registered in <c>server/Viritura.Api/Program.cs</c> and the
 * handler implementation in <c>Signaling/SnapshotEndpoint.cs</c>.
 *
 * The snapshot store is the out-of-band initial-state sidecar that
 * accompanies WebRTC live collab — see <c>packages/crdt/src/snapshotClient.ts</c>
 * for why it exists. URL shape: <c>{apiBase}/live/room/{roomId}/snapshot</c>.
 */
export function getDefaultSnapshotUrl(roomId: string): string {
  const apiBase = getVirituraApiBaseUrl();
  return `${apiBase.replace(/\/+$/, "")}/live/room/${encodeURIComponent(roomId)}/snapshot`;
}

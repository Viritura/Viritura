/**
 * Snapshot client — HTTPS sidecar for the WebRTC live-collab transport.
 *
 * Why this exists. y-webrtc's initial-sync handshake fires the joining
 * peer's entire <c>Y.encodeStateAsUpdate</c> as a single SCTP data-channel
 * message, and Chromium caps that at 256 KB. A real symphonic score
 * (Beethoven 5 Finale at ~365 KB) blows past the cap and the message is
 * silently dropped — peer connection comes up, awareness flows, small
 * post-connect edits replicate, but the late joiner never sees the
 * document. The fix is to deliver the initial state out of band via
 * HTTPS (no size cap) and let WebRTC do what it's good at: small
 * post-connect deltas.
 *
 * Why it's keyed on a single URL. Each room's snapshot lives at a stable
 * server path (<c>/live/room/{roomId}/snapshot</c>) and the client only
 * ever talks to that one URL — the caller resolves the path once and
 * hands us the result, which keeps this module dependency-free of the
 * editor's URL helpers.
 */

/**
 * Minimal contract a live session needs from "the place where snapshots
 * live". Implementations: {@link createHttpSnapshotClient} for prod,
 * trivial in-memory fakes for tests.
 */
export interface SnapshotClient {
  /**
   * Resolve with the most recently stored snapshot bytes, or <c>null</c>
   * if the room has no snapshot yet (fresh share link, host hasn't pushed
   * anything). Throws on transport errors so callers can decide whether
   * to surface them; the live-session wiring deliberately swallows the
   * throw so a snapshot outage degrades to "P2P-only sync" rather than
   * blocking the session.
   */
  fetch(): Promise<Uint8Array | null>;

  /**
   * Upload <paramref name="bytes"/> as the room's new snapshot, replacing
   * any previous value. Caller is expected to pass
   * <c>Y.encodeStateAsUpdate(doc)</c>; we don't deserialize here.
   */
  upload(bytes: Uint8Array): Promise<void>;
}

/**
 * HTTP-backed snapshot client. The <paramref name="url"/> is the full
 * room-snapshot endpoint (e.g.
 * <c>https://localhost:5001/live/room/{roomId}/snapshot</c>) — callers
 * format the room id into the path; we never see the room id.
 *
 * Credentials are deliberately <c>"omit"</c>: live-collab uses
 * room-id-as-capability, not the user's session cookie. Sending the
 * cookie would tie the snapshot store to authenticated sessions for no
 * benefit and would tighten the CORS allowance for no reason.
 */
export function createHttpSnapshotClient(url: string): SnapshotClient {
  return {
    async fetch(): Promise<Uint8Array | null> {
      const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Snapshot GET ${url} failed: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      return buffer.byteLength === 0 ? null : new Uint8Array(buffer);
    },

    async upload(bytes: Uint8Array): Promise<void> {
      const response = await fetch(url, {
        method: "PUT",
        credentials: "omit",
        headers: { "content-type": "application/octet-stream" },
        // Cast to BodyInit-friendly view. Pass a fresh ArrayBuffer slice
        // so the fetch impl doesn't accidentally retain the caller's
        // Y.Doc-internal buffer past the request lifetime.
        body: bytes.slice().buffer,
      });
      if (!response.ok) {
        throw new Error(`Snapshot PUT ${url} failed: ${response.status} ${response.statusText}`);
      }
    },
  };
}

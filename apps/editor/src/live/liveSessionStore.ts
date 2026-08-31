/**
 * Live-session Zustand store.
 *
 * Owns the lifecycle of an active <c>LiveSession</c> (Y.Doc + WebRTC
 * provider + awareness). State is intentionally narrow — components
 * subscribe to {@link useLiveSessionStore} via selectors so the heavy
 * <c>provider</c> reference never causes re-renders just because awareness
 * states changed.
 */

import { create } from "zustand";
import {
  createHttpSnapshotClient,
  createLiveSession,
  generateRoomId,
  isValidRoomId,
  type CollaboratorIdentity,
  type LiveSession,
  type SnapshotClient,
  type VirituraAwarenessState,
} from "@viritura/crdt";
import { getDefaultSignalingUrls, getDefaultSnapshotUrl } from "./liveUrl";

type LiveSessionStatus = "idle" | "starting" | "active" | "stopped";

export interface LiveSessionStoreState {
  /** The active session, or null when no live session is open. */
  session: LiveSession | null;
  /** Current room id (mirror of <c>session.roomId</c> for selector reads). */
  roomId: string | null;
  /** Lifecycle status. */
  status: LiveSessionStatus;
  /** Last error message, if any. Cleared on successful (re)start. */
  error: string | null;

  /**
   * Boot a new live session and join the given room. If a session is
   * already open it is destroyed first. Safe to call multiple times.
   *
   * @param scoreId optional persistence key — when omitted, the session has
   *   no IndexedDB cache (useful when the underlying score has no stable id
   *   yet, e.g. a fresh in-memory score).
   */
  startLive: (params: {
    roomId?: string;
    identity: CollaboratorIdentity;
    scoreId?: string;
    transport?: "webrtc" | "broadcast-channel";
    signalingUrls?: readonly string[];
  }) => string;
  /** Tear down the active session and return to idle. */
  stopLive: () => void;
  /** Update the local awareness payload (cursor, selection, mode). */
  publishAwareness: (state: VirituraAwarenessState) => void;
}

export const useLiveSessionStore = create<LiveSessionStoreState>((set, get) => ({
  session: null,
  roomId: null,
  status: "idle",
  error: null,

  startLive: ({ roomId, identity, scoreId, transport, signalingUrls }) => {
    const existing = get().session;
    if (existing) {
      existing.destroy();
    }
    const effectiveRoomId = roomId && isValidRoomId(roomId) ? roomId : generateRoomId();
    const initialAwareness: VirituraAwarenessState = { identity, mode: "normal" };
    // Snapshot sidecar only makes sense for the cross-machine WebRTC
    // transport. Broadcast-channel sessions are same-origin / same-browser
    // and the initial-sync problem doesn't apply (no SCTP cap, and the
    // BroadcastChannel API already carries arbitrarily large messages).
    const snapshot: SnapshotClient | undefined =
      transport === "broadcast-channel" ? undefined : createHttpSnapshotClient(getDefaultSnapshotUrl(effectiveRoomId));
    let session: LiveSession;
    try {
      session = createLiveSession({
        roomId: effectiveRoomId,
        scoreId,
        initialAwareness,
        transport,
        // Caller-supplied list wins (set by LiveSessionProvider when the
        // URL has a `?live-signaling=` override); otherwise fall back to
        // the API-hosted relay. The public free Yjs signaling servers
        // are all dead, so we never want createLiveSession's own
        // package-level default to be reached in prod.
        signalingUrls: signalingUrls ?? getDefaultSignalingUrls(),
        snapshot,
      });
    } catch (err) {
      set({ status: "idle", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    set({
      session,
      roomId: effectiveRoomId,
      status: "active",
      error: null,
    });
    return effectiveRoomId;
  },

  stopLive: () => {
    const existing = get().session;
    if (existing) existing.destroy();
    set({ session: null, roomId: null, status: "stopped", error: null });
  },

  publishAwareness: (state) => {
    const existing = get().session;
    if (!existing) return;
    existing.setLocalAwareness(state);
  },
}));

/**
 * @viritura/crdt — Yjs-based collaboration foundation.
 *
 * Phase 5a of <c>docs/plans/crdt-collaboration.md</c>: Y.Doc lifecycle,
 * MNX bridge, awareness types, room helpers, and a WebRTC+IndexedDB
 * live-session bundle. Higher-level editor wiring lives in
 * <c>apps/editor/src/live/</c>.
 */

export { MnxYjsBridge, LOCAL_WRITE_ORIGIN, REMOTE_WRITE_ORIGIN } from "./MnxYjsBridge";

export type {
  AwarenessCursor,
  AwarenessMode,
  AwarenessSelection,
  CollaboratorIdentity,
  VirituraAwarenessState,
} from "./awareness";
export { colorForUserId } from "./awareness";

export type { LiveSession, LiveSessionOptions } from "./LiveSession";
export { createLiveSession } from "./LiveSession";

export type { SnapshotClient } from "./snapshotClient";
export { createHttpSnapshotClient } from "./snapshotClient";

export { generateRoomId, isValidRoomId } from "./roomId";

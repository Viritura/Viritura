/**
 * LiveSession — bundles a Y.Doc, an optional <c>y-webrtc</c> transport, an
 * optional HTTPS snapshot sidecar, and an optional <c>y-indexeddb</c>
 * local persistence into a single lifecycle object owned by the editor's
 * React tree.
 *
 * **Transport choice.** Phase 1 (free tier) uses WebRTC peer-to-peer
 * over our self-hosted signaling relay
 * (<c>server/Viritura.Api/Signaling/SignalingEndpoint.cs</c> →
 * <c>wss://&lt;api&gt;/live/signal</c>, supplied by the editor's
 * <c>getDefaultSignalingUrls()</c>). The public servers Yjs used to
 * bundle (<c>signaling.yjs.dev</c>, <c>y-webrtc-eu.fly.dev</c>) both
 * went dark in 2025 and the package-level <c>DEFAULT_SIGNALING_URLS</c>
 * below is now only a unit-test escape hatch. See
 * <c>docs/plans/crdt-collaboration.md</c> §U3 "Live host session".
 *
 * **Snapshot sidecar.** WebRTC's SCTP data channel caps individual
 * messages at 256 KB, which is below the encoded size of a real-world
 * symphonic score and silently drops y-webrtc's monolithic initial-sync
 * payload. When a {@link LiveSessionOptions.snapshot} client is
 * supplied, the session fetches any prior snapshot from the server over
 * HTTPS (no size cap), applies it before P2P sync takes over, and
 * debounce-pushes the encoded doc state back to the store so the next
 * late joiner picks up where we left off. See
 * <c>packages/crdt/src/snapshotClient.ts</c> for the full rationale.
 *
 * **Persistence choice.** When a <c>scoreId</c> is provided (loaded from
 * disk / file picker), <c>y-indexeddb</c> caches the Y.Doc locally so the
 * next page load can rehydrate without re-parsing MNX. The canonical store
 * remains the user's file/folder (per principle #2 in the plan); IndexedDB
 * is acceleration only.
 */

import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import { MnxYjsBridge } from "./MnxYjsBridge";
import type { VirituraAwarenessState } from "./awareness";
import { attachBroadcastChannelProvider, type BroadcastChannelProvider } from "./BroadcastChannelProvider";
import type { SnapshotClient } from "./snapshotClient";

export interface LiveSessionOptions {
  /**
   * Stable room id for this collaboration session. Two clients joining the
   * same room sync; clients in different rooms are isolated. When this is
   * <c>undefined</c>, no transport is created (solo mode with just Y.Doc +
   * optional persistence).
   */
  readonly roomId?: string;
  /**
   * Stable id for the underlying score document, used as the IndexedDB
   * partition key so different open scores don't share state. When
   * undefined, no IndexedDB persistence is set up.
   */
  readonly scoreId?: string;
  /**
   * Initial awareness state to publish on connect. Identity is required so
   * remote peers can render the collaborator chip even before the local
   * user moves their cursor.
   */
  readonly initialAwareness: VirituraAwarenessState;
  /**
   * Override the public signaling endpoints. Defaults to a small
   * fallback list (see {@link DEFAULT_SIGNALING_URLS}). Tests use a
   * local mock.
   */
  readonly signalingUrls?: readonly string[];
  /**
   * Transport for live sync.
   *  - <c>"webrtc"</c> (default): peer-to-peer via <c>y-webrtc</c>, with
   *    public signaling fallback. Crosses machines but depends on a
   *    reachable signaling server and WebRTC NAT traversal.
   *  - <c>"broadcast-channel"</c>: same-origin only (other tabs of the
   *    same browser). No network. Used by E2E tests and as a free
   *    multi-tab single-user sync mechanism.
   */
  readonly transport?: "webrtc" | "broadcast-channel";
  /**
   * Optional HTTPS-backed snapshot store. When provided, the session:
   *   - fetches any existing snapshot on construction and applies it to
   *     the Y.Doc (catches up late joiners past the WebRTC 256 KB
   *     initial-sync cap — see <c>snapshotClient.ts</c> for context);
   *   - on every doc update, debounces ~2 s and pushes the latest
   *     <c>Y.encodeStateAsUpdate</c> back to the store so the next late
   *     joiner picks up where this client left off.
   * Omit for solo / broadcast-channel sessions where there's no remote
   * sync to seed.
   */
  readonly snapshot?: SnapshotClient;
}

export interface LiveSession {
  readonly doc: Y.Doc;
  readonly bridge: MnxYjsBridge;
  readonly awareness: Awareness | null;
  readonly provider: WebrtcProvider | null;
  readonly persistence: IndexeddbPersistence | null;
  readonly roomId: string | undefined;
  /**
   * Resolves once the initial server snapshot fetch has either applied
   * (success) or failed/short-circuited (no snapshot, no client, or
   * network error). Always resolves — never rejects — so consumers can
   * <c>await</c> it without try/catch. Equals an already-resolved
   * promise when no {@link LiveSessionOptions.snapshot} was provided.
   */
  readonly snapshotReady: Promise<void>;
  /**
   * Snapshot the current awareness states of all peers (including the local
   * client). The map key is the Yjs client id; values are the typed payload.
   */
  getPeers(): Map<number, VirituraAwarenessState>;
  /** Update the local awareness payload. */
  setLocalAwareness(state: VirituraAwarenessState): void;
  destroy(): void;
}

/**
 * Default signaling endpoints. Both of the public servers y-webrtc used
 * to bundle (<c>signaling.yjs.dev</c>, <c>y-webrtc-eu.fly.dev</c>) went
 * dark in 2025, so production builds inject the self-hosted
 * <c>/live/signal</c> endpoint via <c>options.signalingUrls</c>
 * (see <c>apps/editor/src/live/liveUrl.ts</c> &rarr;
 * <c>getDefaultSignalingUrls()</c>). This package-level fallback exists
 * only for unit tests / consumers that forget to pass one in; it points
 * at the original public hosts so failures are visible in dev rather
 * than silent.
 */
const DEFAULT_SIGNALING_URLS = ["wss://y-webrtc-eu.fly.dev", "wss://signaling.yjs.dev"];

/**
 * ICE servers for the WebRTC peer connections. We configure two STUN
 * providers in parallel so a single outage doesn't break peer discovery:
 *
 *   - Cloudflare (<c>stun.cloudflare.com:3478</c>) &mdash; primary
 *   - Google (<c>stun.l.google.com:19302</c>) &mdash; fallback
 *
 * STUN tells each peer its public-facing IP/port so it can publish an
 * <c>srflx</c> ICE candidate; without one, Chrome only emits randomized
 * <c>.local</c> mDNS host candidates, which can't be resolved across
 * browser profiles (e.g. a normal window + an incognito window won't
 * connect even on the same machine). We explicitly opt in here rather
 * than relying on simple-peer's defaults, which have shifted across
 * versions.
 *
 * No TURN relay in v1 &mdash; symmetric-NAT guests fall back to a
 * "couldn't connect" message. See <c>docs/plans/crdt-collaboration.md</c>
 * decision D2.
 */
const DEFAULT_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

/**
 * Build a {@link LiveSession}. The session is hot from the moment this
 * returns — the WebRTC provider will start negotiating with peers
 * immediately, IndexedDB will start hydrating in the background, the
 * snapshot client (if any) will start fetching prior state in the
 * background, and the Y.Doc is safe to read/write through the bridge.
 *
 * Consumers that want to defer their first read until any server-side
 * snapshot has been applied (the typical case for an editor that
 * otherwise risks racing the seed arbitration) should
 * <c>await session.snapshotReady</c> — it always resolves, never throws.
 */
export function createLiveSession(options: LiveSessionOptions): LiveSession {
  const doc = new Y.Doc();
  const bridge = new MnxYjsBridge(doc);

  const persistence = options.scoreId ? new IndexeddbPersistence(`viritura.score.${options.scoreId}`, doc) : null;

  let provider: WebrtcProvider | null = null;
  let bcProvider: BroadcastChannelProvider | null = null;
  let awareness: Awareness | null = null;
  if (options.roomId) {
    const transport = options.transport ?? "webrtc";
    if (transport === "broadcast-channel") {
      bcProvider = attachBroadcastChannelProvider(`viritura.live.${options.roomId}`, doc);
      awareness = bcProvider.awareness;
    } else {
      provider = new WebrtcProvider(`viritura.live.${options.roomId}`, doc, {
        signaling: [...(options.signalingUrls ?? DEFAULT_SIGNALING_URLS)],
        peerOpts: {
          config: { iceServers: [...DEFAULT_ICE_SERVERS] },
        },
      });
      awareness = provider.awareness;
    }
    awareness.setLocalState(options.initialAwareness);
  }

  // -- HTTPS snapshot sidecar -------------------------------------------
  // See snapshotClient.ts for the rationale (WebRTC initial-sync 256 KB cap).
  // Even when no snapshot client is supplied, this property is always
  // defined so consumers can <c>await session.snapshotReady</c> uniformly.
  const SNAPSHOT_ORIGIN = "viritura:snapshot";
  const UPLOAD_DEBOUNCE_MS = 2_000;
  let uploadTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let snapshotReady: Promise<void> = Promise.resolve();

  if (options.snapshot) {
    const snapshot = options.snapshot;

    snapshotReady = (async () => {
      try {
        const bytes = await snapshot.fetch();
        // If the session was torn down while we were waiting on the
        // network, applying the update would resurrect a disposed Y.Doc
        // and leak. Bail.
        if (destroyed || !bytes || bytes.length === 0) return;
        Y.applyUpdate(doc, bytes, SNAPSHOT_ORIGIN);
      } catch (error) {
        // Snapshot fetch is an acceleration, not a hard requirement —
        // log and degrade to "P2P-only sync" rather than failing the
        // session. Late joiners with large docs may see a stuck-empty
        // UI; that's a known limitation captured in the rollout plan.
        console.warn("[live-session] snapshot fetch failed; falling back to P2P-only", error);
      }
    })();

    doc.on("update", (_update: Uint8Array, origin: unknown) => {
      // A late update can fire between destroy() and doc.destroy() (e.g.
      // the WebRTC provider's own teardown can apply one last incoming
      // message). Don't bother scheduling work we'd just throw away.
      if (destroyed) return;
      // Skip echoes of our own snapshot-apply — those would just bounce
      // the same bytes back to the server.
      if (origin === SNAPSHOT_ORIGIN) return;
      if (uploadTimer) clearTimeout(uploadTimer);
      uploadTimer = setTimeout(() => {
        uploadTimer = null;
        if (destroyed) return;
        let encoded: Uint8Array;
        try {
          encoded = Y.encodeStateAsUpdate(doc);
        } catch (error) {
          console.warn("[live-session] failed to encode snapshot for upload", error);
          return;
        }
        snapshot.upload(encoded).catch((error: unknown) => {
          console.warn("[live-session] snapshot upload failed", error);
        });
      }, UPLOAD_DEBOUNCE_MS);
    });
  }

  function setLocalAwareness(state: VirituraAwarenessState): void {
    if (!awareness) return;
    awareness.setLocalState(state);
  }

  function getPeers(): Map<number, VirituraAwarenessState> {
    const out = new Map<number, VirituraAwarenessState>();
    if (!awareness) return out;
    awareness.getStates().forEach((state, clientId) => {
      if (isVirituraAwareness(state)) {
        out.set(clientId, state);
      }
    });
    return out;
  }

  function destroy(): void {
    destroyed = true;
    if (uploadTimer) {
      clearTimeout(uploadTimer);
      uploadTimer = null;
    }
    if (provider) {
      provider.disconnect();
      provider.destroy();
    }
    if (bcProvider) {
      bcProvider.destroy();
    }
    if (persistence) {
      // Don't `destroy()` here — that wipes the IndexedDB partition. We only
      // want to release the in-memory binding; the cached state must survive
      // for the next session open.
      void persistence.destroy();
    }
    doc.destroy();
  }

  return {
    doc,
    bridge,
    awareness,
    provider,
    persistence,
    roomId: options.roomId,
    snapshotReady,
    getPeers,
    setLocalAwareness,
    destroy,
  };
}

function isVirituraAwareness(value: unknown): value is VirituraAwarenessState {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<VirituraAwarenessState>;
  if (!candidate.identity || typeof candidate.identity !== "object") return false;
  if (typeof candidate.identity.userId !== "string") return false;
  if (typeof candidate.mode !== "string") return false;
  return true;
}

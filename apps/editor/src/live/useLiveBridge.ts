/**
 * useLiveBridge — wires the editor's document store to the active live
 * session's <c>MnxYjsBridge</c> in both directions.
 *
 * Direction A (local → wire):
 *   Subscribe to <c>documentStore.mnxJson</c>; whenever it changes from a
 *   non-empty value, push it into the bridge. The bridge tags the write
 *   with {@link LOCAL_WRITE_ORIGIN} so we don't echo it back to ourselves.
 *
 * Direction B (wire → local):
 *   When a remote update arrives at the bridge, parse the JSON and apply
 *   it via <c>loadScore</c>. We deliberately use <c>loadScore</c> (the
 *   non-dirty path) rather than <c>updateScore</c> because the remote
 *   edit already happened on someone else's machine — we're hydrating,
 *   not editing — and we want history snapshots to track local edits, not
 *   incoming network updates.
 *
 * **Seed-arbitration (host election).** When a peer mounts the bridge,
 * who pushes the initial canonical score into the empty Y.Doc? The
 * answer is derived entirely from session state — no URL hint, no role
 * flag — because both are tamperable / synthesisable by any peer and
 * would only re-encode information already present in the awareness +
 * clientID space:
 *
 *   1. If the bridge already has content → adopt it. (We joined an
 *      already-seeded room; we're a late guest. This bucket also
 *      catches "the server-side snapshot fetch already populated us"
 *      because we wait on <c>session.snapshotReady</c> before
 *      sampling the bridge.)
 *   2. Else if we are alone in awareness AND we have local content →
 *      seed immediately. (We are the room creator; there is no one to
 *      collide with.)
 *   3. Else (empty bridge + at least one peer present) → wait a short
 *      settling window. After the wait, if the bridge is still empty
 *      and we have local content, seed it. Real-world UX is asymmetric
 *      — the inviter has the score, the invitee follows a link with an
 *      empty doc — so a peer holding content is always the right one
 *      to seed. (An earlier version of this code used a lowest-clientID
 *      tiebreaker here, intended to deterministically resolve the
 *      symmetric "two peers both loaded a score and started live at the
 *      same instant" race. In practice that race doesn't happen — room
 *      ids are unique per inviter — and the tiebreaker silently broke
 *      the common case ~50% of the time when the empty-doc guest happened
 *      to draw a lower clientID than the host.)
 *
 * **Ordering with the HTTPS snapshot sidecar.** The live session has an
 * optional snapshot client (<c>packages/crdt/src/snapshotClient.ts</c>)
 * that fetches any prior server-side snapshot on construction. We must
 * <c>await session.snapshotReady</c> before running the seed arbitration
 * above — otherwise a guest joining a room with a server snapshot would
 * race the snapshot fetch against the 750 ms settling timer, occasionally
 * blowing past it and seeding their own (empty) state on top of someone
 * else's document. Awaiting the snapshot turns the race into a strict
 * ordering: snapshot lands → bridge has content → case 1 adopts.
 *
 * **Single-writer caveat.** The Phase 5a bridge stores the MNX as one
 * Y.Text. Concurrent local writes from two peers will corrupt the JSON;
 * the presence UI must surface a single-writer indicator while this is in
 * effect. See <c>packages/crdt/src/MnxYjsBridge.ts</c> header for the
 * follow-up plan.
 */

import { useEffect, useRef } from "react";
import { parseMnx } from "@viritura/format";
import { useDocumentStoreApi } from "../store/DocumentContext";
import { useLiveSessionStore } from "./liveSessionStore";

/**
 * Settling window for the host-election race. Long enough to absorb a
 * BroadcastChannel handshake (sub-millisecond) and a typical WebRTC
 * peer-connect negotiation; short enough that a solo room creator who
 * has no peers (case 2 above bypasses the wait) doesn't pay it.
 */
const SEED_SETTLING_MS = 750;

export function useLiveBridge(): void {
  const documentStore = useDocumentStoreApi();
  const session = useLiveSessionStore((s) => s.session);
  /** Mirror of the most recent MNX we either wrote or received via the bridge. */
  const lastSeenMnxRef = useRef<string>("");

  useEffect(() => {
    if (!session) {
      lastSeenMnxRef.current = "";
      return;
    }
    const { bridge } = session;

    let seedTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Direction-A and Direction-B wiring goes up first so that any update
    // arriving while we're awaiting the snapshot fetch (e.g. a fast
    // BroadcastChannel peer) still flows through the normal apply path.

    const unsubLocal = documentStore.subscribe((state, prev) => {
      if (state.mnxJson === prev.mnxJson) return;
      if (state.mnxJson === lastSeenMnxRef.current) return;
      if (state.mnxJson.length === 0) return;
      lastSeenMnxRef.current = state.mnxJson;
      // Opportunistic host claim: if our local content lands AFTER
      // runSeedArbitration already took the "case 2-prime: nothing to
      // push" branch (the document store finishes loading the default
      // score on a later tick), no one would ever claim host. Passing
      // claimHost is a no-op when someone else has already claimed
      // (setMnxJson / applyPatches only set _meta._hostClientId when
      // undefined).
      const needsHost = bridge.getHostClientId() === null;
      // Fast edit-path: if this transition came from `commitPatches`,
      // the store exposes the same `ScorePatch[]` on `lastCommittedPatches`.
      // Translate those directly into Yjs sub-tree ops instead of
      // re-walking the whole MNX JSON via `setMnxJson`. The bridge
      // falls back to `setMnxJson(state.mnxJson, …)` internally if any
      // patch's target sub-tree is missing (e.g. a concurrent remote
      // delete), so correctness is preserved even when the fast path
      // can't apply cleanly.
      const patches = state.lastCommittedPatches;
      if (patches.length > 0 && state.score) {
        bridge.applyPatches(patches, state.score, state.mnxJson, needsHost ? { claimHost: true } : {});
        return;
      }
      bridge.setMnxJson(state.mnxJson, needsHost ? { claimHost: true } : {});
    });

    const unsubRemote = bridge.onRemoteUpdate((mnxJson) => {
      if (mnxJson === lastSeenMnxRef.current) return;
      if (mnxJson.length === 0) return;
      lastSeenMnxRef.current = mnxJson;
      applyRemoteMnx(mnxJson);
    });

    // Defer the seed-arbitration decision until the server snapshot has
    // had a chance to land. snapshotReady always resolves (never rejects)
    // so we don't need a catch.
    void session.snapshotReady.then(() => {
      if (cancelled) return;
      runSeedArbitration();
    });

    return () => {
      cancelled = true;
      if (seedTimer !== null) clearTimeout(seedTimer);
      unsubLocal();
      unsubRemote();
    };

    function runSeedArbitration(): void {
      const bridgeMnx = bridge.getMnxJson();
      const localMnx = documentStore.getState().mnxJson;
      if (bridgeMnx.length > 0 && bridgeMnx !== localMnx) {
        // Case 1: someone (peer or server snapshot) has already seeded.
        applyRemoteMnx(bridgeMnx);
        lastSeenMnxRef.current = bridgeMnx;
        return;
      }
      if (localMnx.length === 0) {
        // Case 2-prime: nothing to push, nothing to apply. Wait for
        // remote updates.
        lastSeenMnxRef.current = bridgeMnx;
        return;
      }
      // Case 3: bridge is empty and we have local content. Even when
      // we appear to be alone in awareness, defer briefly so the peer
      // handshake (BroadcastChannel or WebRTC) has a chance to surface
      // any other peer that's joining at the same instant — if a remote
      // seed lands during the wait we want to adopt it rather than
      // double-write.
      seedTimer = setTimeout(() => {
        seedTimer = null;
        if (cancelled) return;
        const currentBridge = bridge.getMnxJson();
        if (currentBridge.length > 0) {
          if (currentBridge !== documentStore.getState().mnxJson) {
            applyRemoteMnx(currentBridge);
          }
          lastSeenMnxRef.current = currentBridge;
          return;
        }
        const currentLocal = documentStore.getState().mnxJson;
        if (currentLocal.length === 0) return;
        lastSeenMnxRef.current = currentLocal;
        bridge.setMnxJson(currentLocal, { claimHost: true });
      }, SEED_SETTLING_MS);
    }

    function applyRemoteMnx(json: string): void {
      // During the host's initial seed the MNX is delivered as multiple
      // sub-256KB chunks (see SEED_CHUNK_BYTES in MnxYjsBridge). Each
      // intermediate chunk arrives as a syntactically-incomplete prefix
      // of the eventual JSON; the trailing brace is only present in the
      // final chunk. Skip parse attempts on obviously-partial payloads
      // so we don't flood the console with a parse warning per chunk.
      const trimmed = json.trimEnd();
      const lastChar = trimmed.charCodeAt(trimmed.length - 1);
      // 125 = '}', 93 = ']'
      if (lastChar !== 125 && lastChar !== 93) return;
      try {
        const parsed = parseMnx(JSON.parse(json));
        const fileName = documentStore.getState().fileName;
        documentStore.getState().loadScore(parsed, fileName, json);
      } catch (err) {
        console.warn("[live] Failed to apply remote MNX update:", err);
      }
    }
  }, [session, documentStore]);
}

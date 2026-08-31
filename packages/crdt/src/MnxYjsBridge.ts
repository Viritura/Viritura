/**
 * MNX ↔ Yjs bridge.
 *
 * Holds the canonical Score as a **structural `Y.Map` tree** rooted at the
 * doc's `"score"` key. The tree shape mirrors MNX JSON one-for-one: objects
 * become `Y.Map`, arrays become `Y.Array`, primitives stay primitives. The
 * structural projection is done by the schema-blind walker in
 * {@link ../yProjection | `./yProjection`} — see its docs for the round-trip
 * and minimal-delta proofs.
 *
 * Why structural `Y.Map` instead of a single `Y.Text`:
 *
 * - Per-edit deltas are proportional to the edit, not the document. A
 *   1-field change on a 1.9MB score ships ~30 bytes over the wire instead
 *   of re-streaming the whole document.
 * - Concurrent edits to different fields merge cleanly. The previous
 *   `Y.Text` design had a hard single-writer constraint because the CRDT
 *   would interleave concurrent writers' JSON character-by-character.
 * - The 64KB chunked-insert dance the `Y.Text` design needed to stay under
 *   WebRTC SCTP's `max-message-size` is gone — structural ops are tiny by
 *   construction.
 *
 * The bridge's public surface (`getMnxJson`, `setMnxJson`, `onRemoteUpdate`,
 * host claim) is unchanged so callers (`LiveSession`, editor `live/`
 * wiring) keep working without modification.
 */

import * as Y from "yjs";

import type { Score, ScorePatch } from "@viritura/core";

import { applyScorePatchesToYDoc, readJsonFromYDoc, syncJsonToYDoc } from "./yProjection";
import { PatchTargetNotInYDoc } from "./yProjection/applyScorePatchesToYDoc";

/**
 * Origin token attached to local-write Yjs transactions so the subscriber on
 * the same Y.Doc can ignore its own writes when deciding whether to push a
 * remote update back into the editor.
 */
export const LOCAL_WRITE_ORIGIN = Symbol("viritura.crdt.localWrite");

/**
 * Origin token attached to remote-write Yjs transactions (transport adapter
 * applying an incoming update). The editor-side subscriber uses this to know
 * the resulting Score should NOT be re-broadcast.
 */
export const REMOTE_WRITE_ORIGIN = Symbol("viritura.crdt.remoteWrite");

/**
 * Y.Doc root key that owns the structural score projection. Changed from
 * `"mnx"` (Y.Text) to `"score"` (Y.Map) when the bridge migrated off the
 * single-text design — old persisted Y.Doc state under `"mnx"` is wiped
 * and rebuilt from canonical MNX on next session.
 */
const SCORE_ROOT_KEY = "score";
const META_MAP_KEY = "_meta";
const HOST_CLIENT_ID_FIELD = "hostClientId";

/**
 * Wraps a `Y.Doc` and exposes the MNX-JSON read/write surface plus a
 * subscribe hook for change notifications.
 */
export class MnxYjsBridge {
  readonly doc: Y.Doc;
  private readonly score: Y.Map<unknown>;
  private readonly meta: Y.Map<unknown>;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.score = this.doc.getMap(SCORE_ROOT_KEY);
    this.meta = this.doc.getMap(META_MAP_KEY);
  }

  /**
   * Current MNX JSON string, or empty string if the doc has never been
   * populated. An empty `score` map (fresh doc, no seed) yields `""` for
   * back-compat with the `Y.Text` era; any populated score is serialised
   * via {@link readJsonFromYDoc}.
   */
  getMnxJson(): string {
    if (this.score.size === 0) return "";
    return JSON.stringify(readJsonFromYDoc(this.doc, SCORE_ROOT_KEY));
  }

  /**
   * Replace the canonical MNX with `mnxJson` inside a single Yjs transaction
   * tagged with {@link LOCAL_WRITE_ORIGIN}. Structural sync is idempotent —
   * passing an unchanged JSON string produces zero update events.
   *
   * Passing an empty string clears the score map (the cleared state is
   * what {@link getMnxJson} re-renders as `""`).
   *
   * If `claimHost` is true and no host has been recorded yet, this call
   * also writes the local `doc.clientID` into the doc's `_meta` map
   * atomically with the seed write. That permanent record is the
   * ground-truth answer to "who owns the canonical state of this room?" —
   * it survives awareness churn, and unlike a self-claim broadcast in
   * awareness it is a property of the Y.Doc itself rather than the peer's
   * chatter.
   */
  setMnxJson(mnxJson: string, options: { claimHost?: boolean } = {}): void {
    const target = mnxJson === "" ? ({} as Record<string, unknown>) : (JSON.parse(mnxJson) as Record<string, unknown>);

    this.doc.transact(() => {
      syncJsonToYDoc(target, this.doc, SCORE_ROOT_KEY);
      if (options.claimHost && this.meta.get(HOST_CLIENT_ID_FIELD) === undefined) {
        this.meta.set(HOST_CLIENT_ID_FIELD, this.doc.clientID);
      }
    }, LOCAL_WRITE_ORIGIN);
  }

  /**
   * Fast edit-path counterpart to {@link setMnxJson}. Translates the
   * `patches` directly into Yjs ops on the existing score tree, avoiding
   * the O(score-size) re-walk that the schema-blind path does on every
   * keystroke.
   *
   * `newScore` is the post-patch decoded Score the editor already produced
   * via `applyPatchesToScore` — the adapter reads fresh wire shapes for
   * each affected sub-tree from it. Callers MUST pass a `newScore` that
   * reflects exactly `patches` applied to the score this bridge currently
   * holds; otherwise the parity test invariant ("`applyPatches` and
   * `setMnxJson(serializeMnx(newScore))` produce identical Y.Doc state")
   * is violated.
   *
   * `serializedMnx` is the MNX JSON string that corresponds to `newScore`.
   * It is **only** read in the rare fallback case where a patch's target
   * sub-tree cannot be resolved in the Y.Doc (e.g. concurrent remote
   * delete) — the fast path itself never serialises the whole score.
   * The editor already has this string in hand from its existing pipeline,
   * so threading it through avoids a redundant re-serialisation here.
   *
   * Both the fast path and the fallback share the same Yjs origin
   * ({@link LOCAL_WRITE_ORIGIN}) so {@link onRemoteUpdate} filters either
   * kind of write identically.
   */
  applyPatches(
    patches: readonly ScorePatch[],
    newScore: Score,
    serializedMnx: string,
    options: { claimHost?: boolean } = {},
  ): void {
    try {
      this.doc.transact(() => {
        applyScorePatchesToYDoc(patches, newScore, this.doc, SCORE_ROOT_KEY);
        if (options.claimHost && this.meta.get(HOST_CLIENT_ID_FIELD) === undefined) {
          this.meta.set(HOST_CLIENT_ID_FIELD, this.doc.clientID);
        }
      }, LOCAL_WRITE_ORIGIN);
    } catch (error) {
      if (!(error instanceof PatchTargetNotInYDoc)) throw error;
      this.setMnxJson(serializedMnx, { claimHost: options.claimHost });
    }
  }

  /**
   * The Yjs `clientID` of the peer that originally seeded the canonical
   * MNX into this room, or `null` if no peer has seeded yet. Once set,
   * this never changes for the lifetime of the room.
   *
   * Use the awareness peer set to determine whether that peer is currently
   * connected: `awareness.getStates().has(getHostClientId())`.
   */
  getHostClientId(): number | null {
    const value = this.meta.get(HOST_CLIENT_ID_FIELD);
    return typeof value === "number" ? value : null;
  }

  /**
   * Subscribe to changes to the host-clientId record. Fires once whenever
   * the field transitions (set, or — should not happen in practice — cleared).
   * Returns an unsubscribe function.
   */
  onHostClaimChange(callback: (hostClientId: number | null) => void): () => void {
    const observer = (event: Y.YMapEvent<unknown>): void => {
      if (!event.keysChanged.has(HOST_CLIENT_ID_FIELD)) return;
      callback(this.getHostClientId());
    };
    this.meta.observe(observer);
    return () => {
      this.meta.unobserve(observer);
    };
  }

  /**
   * Subscribe to changes that did NOT originate from {@link setMnxJson} on
   * this bridge. The callback fires with the new MNX JSON after every
   * remote update; if the doc is empty after the update (e.g. nothing has
   * ever been pushed into a freshly-joined room) the callback receives an
   * empty string and the caller is expected to ignore it.
   *
   * Returns an unsubscribe function.
   *
   * Listens on `doc.on("afterTransaction", …)` rather than observing the
   * score map directly: in the structural design a remote update can touch
   * many nested containers in one transaction, and we only want to fire the
   * callback once per transaction with the post-transaction MNX. The
   * `afterTransaction` event also surfaces transactions that affect the
   * `_meta` map without changing the score (host claim from a peer); those
   * are filtered out by checking whether any of the transaction's
   * `changedParentTypes` entries live inside the score tree.
   */
  onRemoteUpdate(callback: (mnxJson: string) => void): () => void {
    const handler = (transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_WRITE_ORIGIN) return;
      if (!touchedScoreTree(transaction, this.score)) return;
      callback(this.getMnxJson());
    };
    this.doc.on("afterTransaction", handler);
    return () => {
      this.doc.off("afterTransaction", handler);
    };
  }
}

/**
 * True if the transaction modified the score tree (the root map itself or
 * any nested container that has the score map as an ancestor).
 */
function touchedScoreTree(transaction: Y.Transaction, scoreRoot: Y.Map<unknown>): boolean {
  for (const type of transaction.changedParentTypes.keys()) {
    if (containerIsInTree(type, scoreRoot)) return true;
  }
  return false;
}

function containerIsInTree(type: unknown, root: Y.Map<unknown>): boolean {
  let current = type as { parent: unknown } | null;
  while (current) {
    if (current === root) return true;
    current = (current as { parent: unknown }).parent as { parent: unknown } | null;
  }
  return false;
}

/**
 * Structural sync: mutate an existing Y.Doc tree in place so it equals
 * a target JSON value, emitting **minimal Yjs ops** rather than rebuilding
 * from scratch.
 *
 * Why this matters:
 *
 * - Re-projecting on every edit ({@link projectJsonIntoYDoc}) discards CRDT
 *   identity: every container is replaced, every remote peer effectively
 *   re-downloads the whole tree, awareness anchors detach. Useless for
 *   collaboration.
 * - This walker compares the existing tree against the target JSON and
 *   only touches the keys / array slots that actually changed. The CRDT
 *   stays intact; deltas over the wire are proportional to the edit, not
 *   the document size.
 *
 * The walker is **schema-blind** by design — same as {@link projectJsonIntoYDoc}.
 * It uses runtime kind dispatch (`Array.isArray`, `instanceof Y.Map`, etc.)
 * and works on any MNX-shaped JSON.
 *
 * Array diff strategy (deliberately simple, not optimal):
 *
 * - Position-by-position recurse for indices present on both sides.
 * - Trailing tail: `Y.Array.delete` if target is shorter, `push` if longer.
 * - This produces correct trees but non-minimal deltas for front-insert /
 *   middle-insert edits. A Myers / LCS pass is a follow-up; the wins it
 *   buys are bandwidth, not correctness.
 */

import * as Y from "yjs";

import { toYValue } from "./jsonToYDoc";

const ROOT_KEY = "score";

/**
 * Sync a Y.Doc to match `target` JSON. Wraps everything in a single
 * transaction so observers see one coherent delta.
 *
 * Returns the populated root `Y.Map` for chaining/test inspection.
 */
export function syncJsonToYDoc(
  target: Record<string, unknown>,
  ydoc: Y.Doc,
  rootKey: string = ROOT_KEY,
  origin?: unknown,
): Y.Map<unknown> {
  const root = ydoc.getMap<unknown>(rootKey);
  ydoc.transact(() => {
    syncYMap(root, target);
  }, origin);
  return root;
}

/**
 * Recursively sync `current` (a `Y.Map`) so it matches `target` (a plain
 * object). Exported so the per-patch adapter can scope a sync to an event
 * or measure sub-tree (`applyScorePatchesToYDoc`) instead of running it
 * over the whole score on every keystroke.
 */
export function syncYMap(current: Y.Map<unknown>, target: Record<string, unknown>): void {
  // Delete keys that are gone (or now `undefined`) from the target.
  for (const key of current.keys()) {
    const targetValue = target[key];
    if (targetValue === undefined) {
      current.delete(key);
    }
  }

  // Add / update keys present in the target.
  for (const [key, targetValue] of Object.entries(target)) {
    if (targetValue === undefined) continue;
    const existing = current.get(key);
    if (canReconcileInPlace(existing, targetValue)) {
      reconcileInPlace(existing, targetValue);
    } else if (!isStructurallyEqual(existing, targetValue)) {
      current.set(key, toYValue(targetValue));
    }
  }
}

/**
 * Recursively sync `current` (a `Y.Array`) so it matches `target`. Exported
 * for the same reason as {@link syncYMap}.
 */
export function syncYArray(current: Y.Array<unknown>, target: readonly unknown[]): void {
  const overlap = Math.min(current.length, target.length);

  // Reconcile overlapping prefix.
  for (let i = 0; i < overlap; i++) {
    const existing = current.get(i);
    const targetValue = target[i];
    if (canReconcileInPlace(existing, targetValue)) {
      reconcileInPlace(existing, targetValue);
    } else if (!isStructurallyEqual(existing, targetValue)) {
      // Y.Array has no `set` op; delete + insert at the same position
      // preserves all surrounding identity.
      current.delete(i, 1);
      current.insert(i, [toYValue(targetValue)]);
    }
  }

  // Trim trailing tail if target is shorter.
  if (target.length < current.length) {
    current.delete(target.length, current.length - target.length);
  }

  // Append trailing tail if target is longer.
  if (target.length > current.length) {
    const tail = target.slice(current.length).map(toYValue);
    current.push(tail);
  }
}

function canReconcileInPlace(existing: unknown, target: unknown): boolean {
  if (existing instanceof Y.Map && isPlainObject(target)) return true;
  if (existing instanceof Y.Array && Array.isArray(target)) return true;
  return false;
}

function reconcileInPlace(existing: unknown, target: unknown): void {
  if (existing instanceof Y.Map && isPlainObject(target)) {
    syncYMap(existing as Y.Map<unknown>, target);
    return;
  }
  if (existing instanceof Y.Array && Array.isArray(target)) {
    syncYArray(existing as Y.Array<unknown>, target);
    return;
  }
  // Unreachable given canReconcileInPlace check, but keeps TS narrowing happy.
  throw new Error("reconcileInPlace called with non-reconcilable values");
}

/**
 * Cheap equality check for primitive leaves. Returns false for any
 * container-shaped value (we never want to skip a recurse on those — the
 * inner state may have drifted even if the outer reference is the same).
 */
function isStructurallyEqual(existing: unknown, target: unknown): boolean {
  if (existing instanceof Y.Map || existing instanceof Y.Array) return false;
  if (Array.isArray(target) || isPlainObject(target)) return false;
  return Object.is(existing, target);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

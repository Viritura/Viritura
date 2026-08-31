/**
 * Structural projection of a plain JSON value into a Yjs container tree.
 *
 * Prototype for the schema-walk approach to auto-generated Y.Doc bindings
 * (see ADR / data-model-pipeline.md). The walker is **schema-blind**: it
 * uses only the runtime shape of the JSON value to decide which Y type to
 * materialise. That keeps the prototype minimal while validating round-trip
 * parity against real scores.
 *
 * Mapping:
 *
 * | Source value             | Y container/value      |
 * | ------------------------ | ---------------------- |
 * | `Array`                  | `Y.Array`              |
 * | plain object (`{}`)      | `Y.Map`                |
 * | string / number / bool   | stored as-is (leaf)    |
 * | `null`                   | stored as-is (leaf)    |
 * | `undefined`              | key is omitted         |
 *
 * Strings are leaves (not `Y.Text`) for now — collaborative text needs a
 * schema annotation to opt in, and we have no such fields today.
 */

import * as Y from "yjs";

/**
 * Recursively project `source` into `target` (a `Y.Map`). Keys with
 * `undefined` values are skipped to match JSON semantics.
 */
function jsonObjectToYMap(source: Record<string, unknown>, target: Y.Map<unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    target.set(key, toYValue(value));
  }
}

/**
 * Project an arbitrary JSON value to whatever Y representation fits. Objects
 * become fresh `Y.Map`s, arrays become fresh `Y.Array`s, everything else
 * passes through.
 */
export function toYValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    arr.push(value.map(toYValue));
    return arr;
  }
  if (isPlainObject(value)) {
    const map = new Y.Map<unknown>();
    jsonObjectToYMap(value, map);
    return map;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Convenience: project a top-level MNX-shaped JSON object into `ydoc` under
 * the given root key. Returns the populated root `Y.Map` for chaining.
 */
export function projectJsonIntoYDoc(json: Record<string, unknown>, ydoc: Y.Doc, rootKey = "score"): Y.Map<unknown> {
  const root = ydoc.getMap<unknown>(rootKey);
  // Wipe any prior state so re-projection is idempotent.
  root.clear();
  ydoc.transact(() => {
    jsonObjectToYMap(json, root);
  });
  return root;
}

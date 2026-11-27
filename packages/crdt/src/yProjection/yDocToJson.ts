/**
 * Inverse of {@link jsonToYDoc}: read a Yjs container tree back into a
 * plain JSON value.
 *
 * Y.Map → plain object, Y.Array → array, primitives pass through. Used by
 * the round-trip parity test to prove the structural projection is
 * lossless.
 */

import * as Y from "yjs";
import { canonicalizeFermataJson } from "./fermatas";

function yMapToJsonObject(source: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of source.entries()) {
    out[key] = fromYValue(value);
  }
  return out;
}

function fromYValue(value: unknown): unknown {
  if (value instanceof Y.Array) {
    return (value.toArray() as unknown[]).map(fromYValue);
  }
  if (value instanceof Y.Map) {
    return yMapToJsonObject(value as Y.Map<unknown>);
  }
  return value !== null && typeof value === "object" ? structuredClone(value) : value;
}

export function readJsonFromYDoc(ydoc: Y.Doc, rootKey = "score"): Record<string, unknown> {
  const result = yMapToJsonObject(ydoc.getMap<unknown>(rootKey));
  canonicalizeFermataJson(result);
  return result;
}

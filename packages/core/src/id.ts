/**
 * ID generation — UUID v7 for score elements.
 *
 * Format: canonical hyphenated UUID v7 (36 chars, e.g.
 * "01927f8a-3a4c-7c8d-9e2f-1a2b3c4d5e6f"). 48-bit unix-millisecond prefix
 * + 74 random bits + version/variant nibbles.
 *
 * Why v7 over v4 or short base36:
 *   - Time-ordered: lexicographic sort ≈ creation order. Useful for log
 *     correlation, CRDT op debugging, and (eventually) DB index locality
 *     on the server tier (Postgres/SQL Server B-trees love sequential keys).
 *   - 74 random bits ≈ 1.9e22 space — collision-free at any musical scale.
 *   - Canonical string parses as `Guid` in C# and `uuid::Uuid` in Rust,
 *     so the same id flows through the TS editor, Rust engine, and .NET
 *     server with no custom format glue.
 *
 * Browser/Node both ship v4 natively (`crypto.randomUUID()`), so v7 is
 * built by hand below; this is ~20 lines of byte layout, not crypto.
 */

import type { Score } from "./model/score";

const HEX = "0123456789abcdef";

function toHex(byte: number): string {
  return HEX[(byte >>> 4) & 0xf]! + HEX[byte & 0xf]!;
}

/**
 * Generate a UUID v7 (canonical hyphenated form, 36 chars).
 * Uses crypto.getRandomValues when available, falls back to Math.random.
 */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const ts = Date.now();
  // 48-bit big-endian unix-ms timestamp in bytes 0..5
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = (ts >>> 24) & 0xff;
  bytes[3] = (ts >>> 16) & 0xff;
  bytes[4] = (ts >>> 8) & 0xff;
  bytes[5] = ts & 0xff;
  // Version 7 in high nibble of byte 6
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // RFC 4122 variant (10xx) in high bits of byte 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += toHex(bytes[i]!);
    if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
  }
  return s;
}

/**
 * Generate a unique ID that doesn't collide with any ID in the given set.
 */
export function generateUniqueId(existingIds: ReadonlySet<string>): string {
  let id = generateId();
  while (existingIds.has(id)) {
    id = generateId();
  }
  return id;
}

/**
 * Collect all IDs from a score into a Set for collision checking.
 */
export function collectScoreIds(score: Score): Set<string> {
  const ids = new Set<string>();
  for (const gm of score.global.measures) {
    if (gm.id) ids.add(gm.id);
  }
  for (const part of score.parts) {
    if (part.id) ids.add(part.id);
    for (const pm of part.measures) {
      for (const dynamic of pm.dynamics ?? []) {
        ids.add(dynamic.id);
      }
      for (const seq of pm.sequences) {
        collectContentIds(seq.content, ids);
      }
    }
  }
  return ids;
}

function collectContentIds(
  content: ReadonlyArray<{
    type: string;
    id?: string;
    notes?: ReadonlyArray<{ id?: string }>;
    content?: ReadonlyArray<unknown>;
  }>,
  ids: Set<string>,
): void {
  for (const item of content) {
    if (item.id) ids.add(item.id);
    if (item.notes) {
      for (const n of item.notes) {
        if (n.id) ids.add(n.id);
      }
    }
    if (item.content && Array.isArray(item.content)) {
      collectContentIds(
        item.content as ReadonlyArray<{
          type: string;
          id?: string;
          notes?: ReadonlyArray<{ id?: string }>;
          content?: ReadonlyArray<unknown>;
        }>,
        ids,
      );
    }
  }
}

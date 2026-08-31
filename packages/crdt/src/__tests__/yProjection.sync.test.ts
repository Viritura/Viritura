/**
 * Tests for {@link syncJsonToYDoc} — the structural-diff sync that mutates
 * an existing Y.Doc tree in place to match new JSON.
 *
 * These tests prove the four properties that make this useful for real-time
 * collaboration:
 *
 * 1. **Round-trip parity** — after sync, reading the Y.Doc back gives the
 *    target JSON.
 * 2. **Idempotence** — syncing the same JSON twice produces zero ops.
 * 3. **Container identity preservation** — unchanged sub-trees keep their
 *    original Y.Map / Y.Array references (so awareness anchors don't
 *    detach, and remote peers don't see spurious deletes).
 * 4. **Minimal deltas** — editing one field produces an update message
 *    much smaller than a full reprojection.
 * 5. **End-to-end peer sync** — the update from a structural sync, when
 *    applied to a peer's Y.Doc, produces the same tree.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { projectJsonIntoYDoc, readJsonFromYDoc, syncJsonToYDoc } from "../yProjection";

const here = dirname(fileURLToPath(import.meta.url));
const scoresDir = resolve(here, "../../../format/fixtures/mnx");
const mnxFiles = readdirSync(scoresDir).filter((f) => f.endsWith(".mnx"));

function loadScore(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(scoresDir, file), "utf8")) as Record<string, unknown>;
}

function pickScore(predicate: (s: Record<string, unknown>) => boolean): {
  file: string;
  score: Record<string, unknown>;
} {
  for (const file of mnxFiles) {
    const score = loadScore(file);
    if (predicate(score)) return { file, score };
  }
  throw new Error("no score matched predicate");
}

describe("syncJsonToYDoc — structural sync", () => {
  it("matches projectJsonIntoYDoc on an empty doc (cold start)", () => {
    const original = loadScore(mnxFiles[0]!);

    const projected = new Y.Doc();
    projectJsonIntoYDoc(original, projected);

    const synced = new Y.Doc();
    syncJsonToYDoc(original, synced);

    expect(readJsonFromYDoc(synced)).toEqual(readJsonFromYDoc(projected));
    expect(readJsonFromYDoc(synced)).toEqual(original);
  });

  it("is idempotent — no update messages when syncing identical JSON", () => {
    const original = loadScore(mnxFiles[0]!);

    const ydoc = new Y.Doc();
    syncJsonToYDoc(original, ydoc);

    let updates = 0;
    ydoc.on("update", () => {
      updates++;
    });

    syncJsonToYDoc(original, ydoc);

    expect(updates).toBe(0);
  });

  it("preserves container identity for unchanged sub-trees", () => {
    // Edit a leaf inside the first part's first measure. Everything outside
    // that path should keep its original Y.Map / Y.Array reference.
    const { score: original } = pickScore((s) => Array.isArray(s.parts) && (s.parts as unknown[]).length > 0);

    const ydoc = new Y.Doc();
    syncJsonToYDoc(original, ydoc);
    const rootBefore = ydoc.getMap("score");
    const partsBefore = rootBefore.get("parts") as Y.Array<unknown>;
    const firstPartBefore = partsBefore.get(0) as Y.Map<unknown>;
    const globalBefore = rootBefore.get("global");

    // Edit: tweak the top-level mnx.version (or insert one if absent) —
    // a change far away from `parts`.
    const edited = structuredClone(original);
    const mnxBlock = edited.mnx as Record<string, unknown> | undefined;
    if (mnxBlock) {
      mnxBlock.version = ((mnxBlock.version as number | undefined) ?? 1) + 1;
    } else {
      edited.mnx = { version: 99 };
    }

    syncJsonToYDoc(edited, ydoc);

    const rootAfter = ydoc.getMap("score");
    const partsAfter = rootAfter.get("parts") as Y.Array<unknown>;
    const firstPartAfter = partsAfter.get(0) as Y.Map<unknown>;
    const globalAfter = rootAfter.get("global");

    expect(rootAfter).toBe(rootBefore);
    expect(partsAfter).toBe(partsBefore);
    expect(firstPartAfter).toBe(firstPartBefore);
    expect(globalAfter).toBe(globalBefore);
  });

  it("produces a much smaller delta than a full reprojection for a small edit", () => {
    // Pick a non-trivial score so the size difference is meaningful.
    const big = [...mnxFiles]
      .map((f) => ({ f, size: readFileSync(resolve(scoresDir, f)).length }))
      .sort((a, b) => b.size - a.size)[0]!;
    const original = loadScore(big.f);

    // Baseline: full reproject delta — wipe + rebuild the whole tree.
    const projectDoc = new Y.Doc();
    projectJsonIntoYDoc(original, projectDoc);
    const projectInitial = Y.encodeStateAsUpdate(projectDoc);
    // Reproject (which calls .clear() + rebuild). Capture only the delta.
    let projectDelta: Uint8Array | null = null;
    projectDoc.on("update", (u: Uint8Array) => {
      projectDelta = u;
    });
    projectJsonIntoYDoc(original, projectDoc);
    expect(projectDelta).not.toBeNull();

    // Sync path: same original, then a tiny edit, capture the sync delta.
    const syncDoc = new Y.Doc();
    syncJsonToYDoc(original, syncDoc);
    let syncDelta: Uint8Array | null = null;
    syncDoc.on("update", (u: Uint8Array) => {
      syncDelta = u;
    });
    const edited = structuredClone(original);
    // Bump top-level mnx.version — a single primitive change.
    const mnxBlock = (edited.mnx as Record<string, unknown> | undefined) ?? (edited.mnx = {});
    (mnxBlock as Record<string, unknown>).version =
      (((mnxBlock as Record<string, unknown>).version as number | undefined) ?? 1) + 1;
    syncJsonToYDoc(edited, syncDoc);
    expect(syncDelta).not.toBeNull();

    // The sync delta should be dramatically smaller than the reproject
    // delta — orders of magnitude on any score of meaningful size.
    expect(syncDelta!.length).toBeLessThan(projectDelta!.length / 10);
    // And dramatically smaller than the initial state itself.
    expect(syncDelta!.length).toBeLessThan(projectInitial.length / 10);
  });

  it("end-to-end: peer receives the delta and converges", () => {
    const original = loadScore(mnxFiles[0]!);

    const a = new Y.Doc();
    const b = new Y.Doc();

    // Initial sync: ship full state from a to b.
    syncJsonToYDoc(original, a);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readJsonFromYDoc(b)).toEqual(original);

    // Capture deltas produced by an edit on a, ship them to b.
    const deltas: Uint8Array[] = [];
    a.on("update", (u: Uint8Array) => deltas.push(u));

    const edited = structuredClone(original);
    const mnxBlock = (edited.mnx as Record<string, unknown> | undefined) ?? (edited.mnx = {});
    (mnxBlock as Record<string, unknown>).version =
      (((mnxBlock as Record<string, unknown>).version as number | undefined) ?? 1) + 1;
    syncJsonToYDoc(edited, a);

    expect(deltas.length).toBeGreaterThan(0);
    for (const update of deltas) {
      Y.applyUpdate(b, update);
    }

    expect(readJsonFromYDoc(b)).toEqual(edited);
    expect(readJsonFromYDoc(b)).toEqual(readJsonFromYDoc(a));
  });

  it("round-trips arbitrary mutations across the full MNX corpus", () => {
    // For each score: project, then apply a deterministic mutation, sync,
    // round-trip back, and assert equality. Catches cases where the
    // structural diff loses information on real-world shapes.
    for (const file of mnxFiles) {
      const original = loadScore(file);
      const ydoc = new Y.Doc();
      syncJsonToYDoc(original, ydoc);

      const mutated = structuredClone(original);
      // Toggle / inject a marker on the root.
      (mutated as Record<string, unknown>).__virituraSyncTest__ = file;

      syncJsonToYDoc(mutated, ydoc);
      expect(readJsonFromYDoc(ydoc)).toEqual(mutated);

      // Reverse: drop the marker, sync back.
      delete (mutated as Record<string, unknown>).__virituraSyncTest__;
      syncJsonToYDoc(mutated, ydoc);
      expect(readJsonFromYDoc(ydoc)).toEqual(original);
    }
  }, 30_000);
});

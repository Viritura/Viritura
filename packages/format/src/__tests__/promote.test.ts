/**
 * Promote (Raw MNX → decoded Score) tests.
 *
 * Verifies that {@link promote} produces exactly the same Score as
 * {@link parseMnx} for every MNX example file in the repo. This guards
 * the type-safe entry point from drifting away from the legacy
 * `unknown`-accepting parser as parse helpers get migrated to consume
 * typed Raw inputs.
 *
 * Auto-assigned IDs are random UUID v7 per parse, so we strip IDs that
 * were *not* present in the source file before comparing the two outputs.
 * Source-provided IDs must still match exactly.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseMnx } from "../mnx/parser";
import { promote, type RawScore } from "../mnx/promote";

const scoresDir = path.resolve(__dirname, "../../fixtures/mnx");

const mnxFiles = fs
  .readdirSync(scoresDir)
  .filter((f) => f.endsWith(".mnx"))
  .sort();

/**
 * Walk the raw source JSON and collect every position (parent + key)
 * where an `id` field was *present*. After parse, IDs at any other
 * position were minted by `assignMissingIds` and are non-deterministic;
 * we null them out so structural comparison still works.
 */
function stripAutoIds(parsed: unknown, source: unknown): void {
  if (parsed === null || typeof parsed !== "object") return;
  if (Array.isArray(parsed)) {
    const src = Array.isArray(source) ? source : [];
    for (let i = 0; i < parsed.length; i++) {
      stripAutoIds(parsed[i], src[i]);
    }
    return;
  }
  const p = parsed as Record<string, unknown>;
  const s = (source && typeof source === "object" && !Array.isArray(source) ? source : {}) as Record<string, unknown>;
  if ("id" in p && !("id" in s)) {
    delete p.id;
  }
  for (const k of Object.keys(p)) {
    if (k === "id") continue;
    stripAutoIds(p[k], s[k]);
  }
}

describe("promote(raw) matches parseMnx(json)", () => {
  it("has MNX example files to test against", () => {
    expect(mnxFiles.length).toBeGreaterThan(0);
  });

  for (const file of mnxFiles) {
    it(`promotes ${file} identically to parseMnx`, () => {
      const raw = fs.readFileSync(path.join(scoresDir, file), "utf-8");
      const sourceJson = JSON.parse(raw) as RawScore;
      // Fresh deep clones for each path so neither mutates the other.
      const a = promote(JSON.parse(raw) as RawScore);
      const b = parseMnx(JSON.parse(raw) as RawScore);
      stripAutoIds(a, sourceJson);
      stripAutoIds(b, sourceJson);
      expect(a).toEqual(b);
    });
  }
});

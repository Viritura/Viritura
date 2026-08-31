/**
 * Round-trip parity test for the schema-blind Y.Doc projection.
 *
 * Loads every shipped MNX example score, projects it into a fresh Y.Doc,
 * reads it back into plain JSON, and asserts deep equality with the
 * original. If this passes for all 71 scores, the schema-blind structural
 * walker is lossless on the actual MNX corpus.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { projectJsonIntoYDoc, readJsonFromYDoc } from "../yProjection";

const here = dirname(fileURLToPath(import.meta.url));
const scoresDir = resolve(here, "../../../format/fixtures/mnx");

const mnxFiles = readdirSync(scoresDir).filter((f) => f.endsWith(".mnx"));

describe("yProjection round-trip (schema-blind walker)", () => {
  it("found MNX example files", () => {
    expect(mnxFiles.length).toBeGreaterThan(0);
  });

  for (const file of mnxFiles) {
    it(`round-trips ${file}`, () => {
      const raw = readFileSync(resolve(scoresDir, file), "utf8");
      const original = JSON.parse(raw) as Record<string, unknown>;

      const ydoc = new Y.Doc();
      projectJsonIntoYDoc(original, ydoc);
      const decoded = readJsonFromYDoc(ydoc);

      expect(decoded).toEqual(original);
    });
  }

  it("encodes / decodes via the Yjs wire format losslessly", () => {
    // Prove that the Y.Doc itself (not just the in-process containers)
    // round-trips: encode → applyUpdate to a fresh doc → read back.
    const file = mnxFiles[0]!;
    const original = JSON.parse(readFileSync(resolve(scoresDir, file), "utf8")) as Record<string, unknown>;

    const sender = new Y.Doc();
    projectJsonIntoYDoc(original, sender);
    const update = Y.encodeStateAsUpdate(sender);

    const receiver = new Y.Doc();
    Y.applyUpdate(receiver, update);
    const decoded = readJsonFromYDoc(receiver);

    expect(decoded).toEqual(original);
  });
});

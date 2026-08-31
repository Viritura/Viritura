/**
 * DeltaSerializer tests — incremental full-JSON assembly and patch building.
 *
 * The delta serializer must produce byte-identical output to a full
 * serializeMnx() while only re-serializing changed measures. It also exposes
 * buildPatch(), which assembles the WASM patch JSON ({ globalMeasures,
 * partMeasures }) directly from its per-measure caches.
 */

import { describe, it, expect } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { DeltaSerializer } from "../mnx/deltaSerializer";
import type { Score, NoteEvent } from "@viritura/core";
import * as fs from "node:fs";
import * as path from "node:path";

const scoresDir = path.resolve(__dirname, "../../fixtures/mnx");

const mnxFiles = fs
  .readdirSync(scoresDir)
  .filter((f) => f.endsWith(".mnx"))
  .sort();

/** Find the first NoteEvent in a score and return a mutation locator. */
function firstNoteEvent(score: Score): { partIndex: number; measureIndex: number } | null {
  for (let pi = 0; pi < score.parts.length; pi++) {
    const measures = score.parts[pi]!.measures;
    for (let mi = 0; mi < measures.length; mi++) {
      for (const seq of measures[mi]!.sequences) {
        for (const item of seq.content) {
          if (item.type === "event") return { partIndex: pi, measureIndex: mi };
        }
      }
    }
  }
  return null;
}

/**
 * Recolor the first note of the first event in one part-measure, cloning only
 * the path from the Score root down to that measure (structural sharing — the
 * way Immer produces edits, so the DeltaSerializer's ref checks see exactly one
 * changed measure).
 */
function recolorFirstNote(score: Score, partIndex: number, measureIndex: number, color: string): Score {
  const part = score.parts[partIndex]!;
  const measure = part.measures[measureIndex]!;
  const seq = measure.sequences[0]!;
  const ev = seq.content.find((c) => c.type === "event") as NoteEvent;
  const note0 = ev.notes![0]!;

  const newNote = { ...note0, color };
  const newEv: NoteEvent = { ...ev, notes: [newNote, ...ev.notes!.slice(1)] };
  const newContent = seq.content.map((c) => (c === ev ? newEv : c));
  const newSeq = { ...seq, content: newContent };
  const newMeasure = { ...measure, sequences: [newSeq, ...measure.sequences.slice(1)] };
  const newMeasures = part.measures.map((m, i) => (i === measureIndex ? newMeasure : m));
  const newPart = { ...part, measures: newMeasures };
  const newParts = score.parts.map((p, i) => (i === partIndex ? newPart : p));
  return { ...score, parts: newParts };
}

describe("DeltaSerializer incremental assembly", () => {
  for (const file of mnxFiles) {
    it(`assembles byte-identical full JSON for ${file}`, () => {
      const raw = fs.readFileSync(path.join(scoresDir, file), "utf-8");
      const score = parseMnx(JSON.parse(raw));

      const delta = new DeltaSerializer();
      const expected = JSON.stringify(serializeMnx(score));

      // First serialize (cold cache) must match.
      expect(delta.serialize(score).json).toBe(expected);
      // Second serialize (warm cache, no changes) must also match.
      expect(delta.serialize(score).json).toBe(expected);
    });
  }

  it("re-serializes only changed measures and matches full output", () => {
    const raw = fs.readFileSync(path.join(scoresDir, "c-major-scale.mnx"), "utf-8");
    let score = parseMnx(JSON.parse(raw));
    const loc = firstNoteEvent(score);
    expect(loc).not.toBeNull();

    const delta = new DeltaSerializer();
    delta.serialize(score); // prime cache

    // Mutate one note's color in one measure (structural sharing).
    score = recolorFirstNote(score, loc!.partIndex, loc!.measureIndex, "#ff0000");

    const result = delta.serialize(score);
    expect(result.json).toBe(JSON.stringify(serializeMnx(score)));
    expect(result.structuralChange).toBe(false);
    // Exactly the one mutated part-measure should be reported as changed.
    const changed = result.changedPartMeasures.get(loc!.partIndex) ?? [];
    expect(changed).toContain(loc!.measureIndex);
  });

  it("prepares a patch before assembling byte-identical full JSON", () => {
    const raw = fs.readFileSync(path.join(scoresDir, "c-major-scale.mnx"), "utf-8");
    let score = parseMnx(JSON.parse(raw));
    const loc = firstNoteEvent(score)!;
    const delta = new DeltaSerializer();
    delta.serialize(score);

    score = recolorFirstNote(score, loc.partIndex, loc.measureIndex, "#123456");
    const prepared = delta.prepare(score);
    const patch = delta.buildPatch(prepared.changedGlobalMeasures, prepared.changedPartMeasures);

    expect(JSON.parse(patch).partMeasures?.[String(loc.partIndex)]?.[String(loc.measureIndex)]).toBeDefined();
    expect(delta.assemble(score)).toBe(JSON.stringify(serializeMnx(score)));
  });

  it("buildPatch emits only the changed measures' MNX JSON", () => {
    const raw = fs.readFileSync(path.join(scoresDir, "c-major-scale.mnx"), "utf-8");
    let score = parseMnx(JSON.parse(raw));
    const loc = firstNoteEvent(score)!;

    const delta = new DeltaSerializer();
    delta.serialize(score);

    score = recolorFirstNote(score, loc.partIndex, loc.measureIndex, "#00ff00");

    const result = delta.serialize(score);
    const patch = JSON.parse(delta.buildPatch(result.changedGlobalMeasures, result.changedPartMeasures)) as {
      partMeasures?: Record<string, Record<string, unknown>>;
    };

    // The patch's part-measure entry must equal the full serializer's output
    // for that exact measure.
    const full = JSON.parse(JSON.stringify(serializeMnx(score))) as {
      parts: { measures: unknown[] }[];
    };
    const patched = patch.partMeasures?.[String(loc.partIndex)]?.[String(loc.measureIndex)];
    expect(patched).toEqual(full.parts[loc.partIndex]!.measures[loc.measureIndex]);
  });

  it("detects a part-level kit edit (notehead) as a structural change", () => {
    // A kit edit (e.g. changing a kit-component's notehead) is part-level, not
    // measure data. It must still register so the engine re-layouts; otherwise
    // the serializer returns the stale cached JSON and the edit never reaches
    // the renderer. Regression for kit changes being invisible to the delta.
    const raw = fs.readFileSync(path.join(scoresDir, "Rhapsody in Blue.mnx"), "utf-8");
    let score = parseMnx(JSON.parse(raw));
    const partIndex = score.parts.findIndex((p) => p.kit && Object.keys(p.kit).length > 0);
    expect(partIndex).toBeGreaterThanOrEqual(0);

    const delta = new DeltaSerializer();
    delta.serialize(score); // prime cache

    // Change one kit-component's notehead (structural sharing down to the kit).
    const part = score.parts[partIndex]!;
    const kitId = Object.keys(part.kit!)[0]!;
    const newKit = { ...part.kit!, [kitId]: { ...part.kit![kitId]!, notehead: "triangleDown" as const } };
    const newPart = { ...part, kit: newKit };
    score = { ...score, parts: score.parts.map((p, i) => (i === partIndex ? newPart : p)) };

    const result = delta.serialize(score);
    expect(result.structuralChange).toBe(true);
    // And the emitted JSON reflects the new notehead (not the stale cache).
    expect(result.json).toBe(JSON.stringify(serializeMnx(score)));
    expect(result.json).toContain('"notehead":"triangleDown"');
  });
});

describe("DeltaSerializer root extensions", () => {
  it("carries a time signature style change into the published JSON", () => {
    const raw = fs.readFileSync(path.join(scoresDir, "c-major-scale.mnx"), "utf-8");
    const score = parseMnx(JSON.parse(raw));

    const delta = new DeltaSerializer();
    const before = delta.serialize(score);
    expect(before.json).not.toContain("timeSignatures");

    // The settings panel edits the score root, sharing every measure.
    const restyled: Score = { ...score, timeSignatures: { score: { scale: 1.5 } } };
    const after = delta.serialize(restyled);

    expect(after.json).toContain('"timeSignatures":{"score":{"scale":1.5}}');
    expect(after.json).toBe(JSON.stringify(serializeMnx(restyled)));
    expect(after.structuralChange).toBe(false);
    expect(after.timeSignatureSettingsChange).toBe(true);
    expect(JSON.parse(delta.buildPatch([], new Map(), true)).timeSignatures).toEqual(restyled.timeSignatures);
  });
});

/**
 * Parity test for {@link applyScorePatchesToYDoc} — the fast edit-path
 * adapter must produce the same Y.Doc tree as the schema-blind path
 * (`setMnxJson` → `syncJsonToYDoc`) for every kind of `ScorePatch`.
 *
 * Strategy
 * ────────
 *
 *   1. Parse a real MNX file → decoded `Score` with deterministic
 *      `auto-N` ids on every event/part/measure (per
 *      `assignMissingIds` in `@viritura/format`).
 *   2. Project the corresponding wire JSON into a "base" Y.Doc.
 *   3. For each interesting patch:
 *        a. **Slow path:** clone base, apply patch to score,
 *           re-serialise, `syncJsonToYDoc` into the clone.
 *        b. **Fast path:** clone base, apply patch to score,
 *           `applyScorePatchesToYDoc` into the clone.
 *        c. Assert both clones' `readJsonFromYDoc` are deep-equal.
 *
 * If this test fails, the adapter has drifted from the canonical
 * serializer output — fix it before shipping.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { applyPatchesToScore, patch, type NoteEvent, type Score, type ScorePatch } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";

import { applyScorePatchesToYDoc, projectJsonIntoYDoc, readJsonFromYDoc, syncJsonToYDoc } from "../yProjection";

const here = dirname(fileURLToPath(import.meta.url));
const scoresDir = resolve(here, "../../../format/fixtures/mnx");

function loadParsedScore(file: string): { score: Score; wire: Record<string, unknown> } {
  const text = readFileSync(resolve(scoresDir, file), "utf8");
  const parsed = parseMnx(JSON.parse(text));
  const wire = JSON.parse(JSON.stringify(serializeMnx(parsed))) as Record<string, unknown>;
  return { score: parsed, wire };
}

function projectBase(wire: Record<string, unknown>): Y.Doc {
  const doc = new Y.Doc();
  projectJsonIntoYDoc(wire, doc);
  return doc;
}

function cloneDoc(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function assertParity(base: Y.Doc, score: Score, patches: readonly ScorePatch[]): void {
  const newScore = applyPatchesToScore(score, patches);
  const newWire = JSON.parse(JSON.stringify(serializeMnx(newScore))) as Record<string, unknown>;

  const slow = cloneDoc(base);
  syncJsonToYDoc(newWire, slow);

  const fast = cloneDoc(base);
  applyScorePatchesToYDoc(patches, newScore, fast, "score");

  expect(readJsonFromYDoc(fast)).toEqual(readJsonFromYDoc(slow));
}

/** Find the first event in a part/measure/voice for test setup. */
function firstEvent(score: Score): {
  partId: string;
  measureIndex: number;
  voice: number;
  event: NoteEvent;
} {
  for (let p = 0; p < score.parts.length; p++) {
    const part = score.parts[p]!;
    for (let m = 0; m < part.measures.length; m++) {
      const seqs = part.measures[m]!.sequences;
      for (let v = 0; v < seqs.length; v++) {
        for (const item of seqs[v]!.content) {
          if (item.type === "event" && item.id) {
            return { partId: part.id!, measureIndex: m, voice: v, event: item };
          }
        }
      }
    }
  }
  throw new Error("no event found in score");
}

describe("applyScorePatchesToYDoc — parity with syncJsonToYDoc", () => {
  const { score, wire } = loadParsedScore("articulations.mnx");
  const base = projectBase(wire);
  const { partId, measureIndex, voice, event } = firstEvent(score);
  const sequencePath = { partId, measureIndex, voice };
  const locator = { sequencePath, eventId: event.id! };
  const noteId = event.notes![0]!.id!;

  it("setNotePitch", () => {
    assertParity(base, score, [patch.setNotePitch(locator, noteId, { step: "G", octave: 4 })]);
  });

  it("setNoteField (staff override)", () => {
    assertParity(base, score, [patch.setNoteField(locator, noteId, { field: "staff", value: 2 })]);
  });

  it("setNoteMarking (note-local slide)", () => {
    assertParity(base, score, [patch.setNoteMarking(locator, noteId, "slideIn", { type: "scoop" })]);
  });

  it("addNoteToEvent", () => {
    assertParity(base, score, [
      patch.addNoteToEvent(locator, {
        id: "test-added-note",
        pitch: { step: "C", octave: 4 },
      }),
    ]);
  });

  it("removeNoteFromEvent (chord first; then remove)", () => {
    // Build a chord first so removing a note is meaningful.
    const seeded = applyPatchesToScore(score, [
      patch.addNoteToEvent(locator, {
        id: "to-remove",
        pitch: { step: "B", octave: 4 },
      }),
    ]);
    const seededWire = JSON.parse(JSON.stringify(serializeMnx(seeded))) as Record<string, unknown>;
    const seededBase = projectBase(seededWire);
    assertParity(seededBase, seeded, [patch.removeNoteFromEvent(locator, "to-remove")]);
  });

  it("setEventField (stemDirection)", () => {
    assertParity(base, score, [patch.setEventField(locator, { field: "stemDirection", value: "up" })]);
  });

  it("setEventField (lyric extender)", () => {
    assertParity(base, score, [
      patch.setEventField(locator, {
        field: "lyrics",
        value: {
          lines: {
            "1": {
              text: "Ah",
              extender: { id: "word-line", show: true, target: event.id!, _c: "comment", _x: { viritura: {} } },
            },
          },
        },
      }),
    ]);
  });

  it("setMnxSupport (lyric extender policy)", () => {
    assertParity(base, score, [patch.setMnxSupport({ useLyricExtenders: true })]);
  });

  it("setEventMarking (add accent)", () => {
    assertParity(base, score, [patch.setEventMarking(locator, "accent", {})]);
  });

  it("setEventMarking (clear marking)", () => {
    assertParity(base, score, [patch.setEventMarking(locator, "staccato", undefined)]);
  });

  it("setMeasureDynamicGroup (add)", () => {
    const groupId = "dynamic-group-1";
    assertParity(base, score, [
      patch.setMeasureDynamicGroup({ partId, measureIndex }, groupId, {
        id: groupId,
        type: "immediate",
        position: { fraction: [0, 1] },
        value: "ff",
      }),
    ]);
  });

  it("setMeasureArpeggio (add)", () => {
    // Need a chord at that event for an arpeggio to make sense.
    const seeded = applyPatchesToScore(score, [
      patch.addNoteToEvent(locator, {
        id: "arp-extra",
        pitch: { step: "G", octave: 5 },
      }),
    ]);
    const seededWire = JSON.parse(JSON.stringify(serializeMnx(seeded))) as Record<string, unknown>;
    const seededBase = projectBase(seededWire);
    assertParity(seededBase, seeded, [
      patch.setMeasureArpeggio(
        { partId, measureIndex },
        { position: { fraction: { numerator: 0, denominator: 4 } } },
        { fromNoteId: noteId, toNoteId: "arp-extra" },
        "up",
      ),
    ]);
  });

  it("spliceSequenceContent (delete one event)", () => {
    // Pick the first two events as range bounds [from..to).
    const sequence = score.parts.find((p) => p.id === partId)!.measures[measureIndex]!.sequences[voice]!;
    const events = sequence.content.filter((c) => c.type === "event") as NoteEvent[];
    if (events.length < 2) throw new Error("test fixture needs ≥2 events");
    assertParity(base, score, [
      patch.spliceSequenceContent({
        sequencePath,
        removeFromEventId: events[0]!.id!,
        removeToEventId: events[1]!.id!,
        insert: [],
      }),
    ]);
  });

  it("batched patches in one call", () => {
    assertParity(base, score, [
      patch.setNotePitch(locator, noteId, { step: "A", octave: 4 }),
      patch.setEventField(locator, { field: "stemDirection", value: "down" }),
      patch.setEventMarking(locator, "tenuto", {}),
    ]);
  });

  it("merges offline v46 edits with a concurrent pitch edit and reopens without loss", () => {
    const local = cloneDoc(base);
    const remote = cloneDoc(base);
    const localPatches = [
      patch.setNoteMarking(locator, noteId, "slideOut", { type: "falloff" }),
      patch.setEventField(locator, {
        field: "lyrics",
        value: { lines: { verse: { text: "Ah", extender: { target: event.id!, show: true } } } },
      }),
      patch.setMnxSupport({ useLyricExtenders: true }),
      patch.setGlobalMeasureField(measureIndex, { field: "caesura", value: { id: "shared-caesura", marks: 2 } }),
      patch.setGlobalMeasureField(measureIndex, { field: "segno", value: { location: { fraction: [0, 1] } } }),
      patch.setGlobalMeasureField(measureIndex, { field: "fine", value: { location: { fraction: [1, 1] } } }),
      patch.setGlobalMeasureField(measureIndex, {
        field: "coda",
        value: { location: { fraction: [1, 2] }, glyph: "codaSquare" },
      }),
      patch.setGlobalMeasureField(measureIndex, {
        field: "jump",
        value: { type: "toCoda", location: { fraction: [1, 4] } },
      }),
    ];
    const remotePatches = [patch.setNotePitch(locator, noteId, { step: "G", octave: 4 })];
    const localScore = applyPatchesToScore(score, localPatches);
    const remoteScore = applyPatchesToScore(score, remotePatches);
    syncJsonToYDoc(JSON.parse(JSON.stringify(serializeMnx(localScore))) as Record<string, unknown>, local);
    applyScorePatchesToYDoc(remotePatches, remoteScore, remote, "score");

    const localUpdate = Y.encodeStateAsUpdate(local);
    const remoteUpdate = Y.encodeStateAsUpdate(remote);
    Y.applyUpdate(local, remoteUpdate);
    Y.applyUpdate(remote, localUpdate);
    Y.applyUpdate(remote, localUpdate);
    expect(readJsonFromYDoc(local)).toEqual(readJsonFromYDoc(remote));

    const reopened = parseMnx(readJsonFromYDoc(remote));
    const expected = applyPatchesToScore(localScore, remotePatches);
    expect(serializeMnx(reopened)).toEqual(serializeMnx(expected));
    expect(reopened.global.measures[measureIndex]).toMatchObject({
      caesura: { id: "shared-caesura", marks: 2 },
      coda: { glyph: "codaSquare" },
      jump: { type: "toCoda" },
    });
    local.destroy();
    remote.destroy();
  });
});

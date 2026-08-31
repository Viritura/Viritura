/**
 * Tests for the note-instance packing function — runs without a GL
 * context and covers the binary layout the vertex shader depends on.
 */

import { describe, expect, it } from "vitest";
import { packNoteInstances, NOTE_INSTANCE_FLOATS } from "./noteInstanceBuffer";
import { FLAG_FROM_REPEAT, FLAG_SELECTED } from "./shaders";
import type { PianoRollNote } from "../types";

function makeNote(overrides: Partial<PianoRollNote> = {}): PianoRollNote {
  return {
    locator: { sequencePath: { partId: "p0", measureIndex: 0, voice: 0 }, eventId: "e0" },
    noteIndex: 0,
    noteId: "n0",
    midiNote: 60,
    velocity: 100,
    partIndex: 0,
    startSeconds: 0,
    endSeconds: 1,
    startMeasure: 0,
    startBeat: 0,
    notatedDurationQuarters: 1,
    fromTie: false,
    fromRepeat: false,
    ...overrides,
  };
}

describe("packNoteInstances", () => {
  it("emits 8 floats per note in the documented order", () => {
    const notes = [makeNote({ midiNote: 64, startSeconds: 1.5, endSeconds: 2.25, partIndex: 3, noteId: "x" })];
    const packed = packNoteInstances({
      notes,
      resolveColor: () => [0.1, 0.2, 0.3, 0.5],
      selection: new Set(),
    });
    expect(packed.length).toBe(NOTE_INSTANCE_FLOATS);
    expect(packed[0]).toBe(64); // midi
    expect(packed[1]).toBeCloseTo(1.5); // startSec
    expect(packed[2]).toBeCloseTo(2.25); // endSec
    expect(packed[3]).toBeCloseTo(0.1); // r
    expect(packed[4]).toBeCloseTo(0.2); // g
    expect(packed[5]).toBeCloseTo(0.3); // b
    expect(packed[6]).toBeCloseTo(0.5); // a
    expect(packed[7]).toBe(0); // flags
  });

  it("sets the SELECTED flag when noteId is in the selection set", () => {
    const notes = [makeNote({ noteId: "sel-me" })];
    const packed = packNoteInstances({
      notes,
      resolveColor: () => [0, 0, 0, 1],
      selection: new Set(["sel-me"]),
    });
    expect(packed[7]! & FLAG_SELECTED).toBe(FLAG_SELECTED);
  });

  it("sets the FROM_REPEAT flag for repeat-expanded notes", () => {
    const notes = [makeNote({ fromRepeat: true })];
    const packed = packNoteInstances({
      notes,
      resolveColor: () => [0, 0, 0, 1],
      selection: new Set(),
    });
    expect(packed[7]! & FLAG_FROM_REPEAT).toBe(FLAG_FROM_REPEAT);
  });

  it("packs multiple notes contiguously", () => {
    const notes = [makeNote({ midiNote: 60 }), makeNote({ midiNote: 62 }), makeNote({ midiNote: 64 })];
    const packed = packNoteInstances({
      notes,
      resolveColor: () => [0, 0, 0, 1],
      selection: new Set(),
    });
    expect(packed.length).toBe(3 * NOTE_INSTANCE_FLOATS);
    expect(packed[0]).toBe(60);
    expect(packed[NOTE_INSTANCE_FLOATS]).toBe(62);
    expect(packed[NOTE_INSTANCE_FLOATS * 2]).toBe(64);
  });
});

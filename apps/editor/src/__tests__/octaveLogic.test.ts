import { describe, it, expect } from "vitest";
import { closestOctave, aboveOctave, DEFAULT_OCTAVE, defaultPitchForClef } from "../input/octaveLogic";
import type { Pitch, Clef } from "@viritura/core";

describe("closestOctave", () => {
  it("returns default octave constant as 5", () => {
    expect(DEFAULT_OCTAVE).toBe(5);
  });

  // PRD example: B4 → C ⇒ C5 (up a half step, not down to C4)
  it("B4 → C gives C5", () => {
    const prev: Pitch = { step: "B", octave: 4 };
    expect(closestOctave("C", prev)).toBe(5);
  });

  // PRD example: A5 → G ⇒ G5 (down a step, not up to G6)
  it("A5 → G gives G5", () => {
    const prev: Pitch = { step: "A", octave: 5 };
    expect(closestOctave("G", prev)).toBe(5);
  });

  // C4 → G: G3 is a 4th down, G4 is a 5th up → G3
  it("C4 → G gives G3 (4th down preferred over 5th up)", () => {
    const prev: Pitch = { step: "C", octave: 4 };
    expect(closestOctave("G", prev)).toBe(3);
  });

  // Same note, same octave
  it("C4 → C gives C4", () => {
    const prev: Pitch = { step: "C", octave: 4 };
    expect(closestOctave("C", prev)).toBe(4);
  });

  // Adjacent step, same octave
  it("D4 → E gives E4", () => {
    const prev: Pitch = { step: "D", octave: 4 };
    expect(closestOctave("E", prev)).toBe(4);
  });

  // F5 → B: B4 is a 5th down, B5 is a 4th up → B5
  it("F5 → B gives B5 (4th up preferred over 5th down)", () => {
    const prev: Pitch = { step: "F", octave: 5 };
    expect(closestOctave("B", prev)).toBe(5);
  });

  // Edge: low octave clamping
  it("C0 → G gives G0 (no negative octave)", () => {
    const prev: Pitch = { step: "C", octave: 0 };
    // G at octave -1 would be ideal (4th down) but clamped; G0 is closest valid
    expect(closestOctave("G", prev)).toBe(0);
  });

  // Edge: high octave clamping
  it("B9 → C gives C9 (no octave 10)", () => {
    const prev: Pitch = { step: "B", octave: 9 };
    // C10 would be ideal but clamped to C9
    expect(closestOctave("C", prev)).toBe(9);
  });

  // Chromatic alteration on prev pitch doesn't change diatonic logic
  it("ignores alter on previous pitch", () => {
    const prev: Pitch = { step: "B", octave: 4, alter: -1 };
    expect(closestOctave("C", prev)).toBe(5);
  });

  // Ascending sequence: C4 D4 E4 F4 G4 → stays in octave 4 going up
  it("ascending C-D-E-F-G stays in octave 4", () => {
    let prev: Pitch = { step: "C", octave: 4 };
    for (const s of ["D", "E", "F"] as const) {
      const oct = closestOctave(s, prev);
      expect(oct).toBe(4);
      prev = { step: s, octave: oct };
    }
  });

  // G4 → A: both A4 (1 up) and A3 (6 down) → A4
  it("G4 → A gives A4", () => {
    const prev: Pitch = { step: "G", octave: 4 };
    expect(closestOctave("A", prev)).toBe(4);
  });

  // E5 → A: A5 is 2 steps up, A4 is 5 steps down → A5
  it("E5 → A gives A5", () => {
    const prev: Pitch = { step: "E", octave: 5 };
    expect(closestOctave("A", prev)).toBe(5);
  });
});

describe("aboveOctave", () => {
  it("C4 + E → E4 (third above)", () => {
    expect(aboveOctave("E", { step: "C", octave: 4 })).toBe(4);
  });

  it("C4 + B → B4 (seventh above)", () => {
    expect(aboveOctave("B", { step: "C", octave: 4 })).toBe(4);
  });

  it("C4 + C → C5 (same step goes up an octave)", () => {
    expect(aboveOctave("C", { step: "C", octave: 4 })).toBe(5);
  });

  it("E4 + G → G4 (above E)", () => {
    expect(aboveOctave("G", { step: "E", octave: 4 })).toBe(4);
  });

  it("B4 + C → C5 (half-step above wraps octave)", () => {
    expect(aboveOctave("C", { step: "B", octave: 4 })).toBe(5);
  });

  it("G4 + A → A4 (step above in same octave)", () => {
    expect(aboveOctave("A", { step: "G", octave: 4 })).toBe(4);
  });

  it("A4 + B → B4", () => {
    expect(aboveOctave("B", { step: "A", octave: 4 })).toBe(4);
  });

  it("clamps to octave 9 max", () => {
    expect(aboveOctave("C", { step: "B", octave: 9 })).toBe(9);
  });
});

describe("defaultPitchForClef", () => {
  it("returns B4 for treble (G) clef", () => {
    const p = defaultPitchForClef({ sign: "G", staffPosition: -2 });
    expect(p).toEqual({ step: "B", octave: 4 });
  });

  it("returns D3 for bass (F) clef", () => {
    const p = defaultPitchForClef({ sign: "F", staffPosition: 2 });
    expect(p).toEqual({ step: "D", octave: 3 });
  });

  it("returns B3 for alto (C) clef", () => {
    const p = defaultPitchForClef({ sign: "C", staffPosition: 0 });
    expect(p).toEqual({ step: "B", octave: 3 });
  });

  it("defaults to treble range for unknown clef signs", () => {
    const p = defaultPitchForClef({ sign: "G", staffPosition: 0, glyph: "unpitchedPercussionClef1" });
    expect(p).toEqual({ step: "B", octave: 4 });
  });

  // ── Octave clefs ──

  it("treble 8vb (octave=-1) returns B3", () => {
    const clef: Clef = { sign: "G", staffPosition: -2, octave: -1 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "B", octave: 3 });
  });

  it("treble 8va (octave=1) returns B5", () => {
    const clef: Clef = { sign: "G", staffPosition: -2, octave: 1 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "B", octave: 5 });
  });

  it("treble 15ma (octave=2) returns B6", () => {
    const clef: Clef = { sign: "G", staffPosition: -2, octave: 2 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "B", octave: 6 });
  });

  it("treble 15mb (octave=-2) returns B2", () => {
    const clef: Clef = { sign: "G", staffPosition: -2, octave: -2 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "B", octave: 2 });
  });

  it("bass 8va (octave=1) returns D4", () => {
    const clef: Clef = { sign: "F", staffPosition: 2, octave: 1 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "D", octave: 4 });
  });

  it("bass 8vb (octave=-1) returns D2", () => {
    const clef: Clef = { sign: "F", staffPosition: 2, octave: -1 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "D", octave: 2 });
  });

  it("alto 8va (octave=1) returns B4", () => {
    const clef: Clef = { sign: "C", staffPosition: 0, octave: 1 };
    expect(defaultPitchForClef(clef)).toEqual({ step: "B", octave: 4 });
  });

  // ── Octave clef clamping ──

  it("clamps to octave 0 for extreme low octave clef", () => {
    const clef: Clef = { sign: "F", staffPosition: 2, octave: -2 };
    // D3 + (-2) = D1 — valid
    expect(defaultPitchForClef(clef)).toEqual({ step: "D", octave: 1 });
  });

  // ── Ottava shift parameter ──

  it("treble clef with 8va ottava returns B5", () => {
    const clef: Clef = { sign: "G", staffPosition: -2 };
    expect(defaultPitchForClef(clef, 1)).toEqual({ step: "B", octave: 5 });
  });

  it("treble clef with 8vb ottava returns B3", () => {
    const clef: Clef = { sign: "G", staffPosition: -2 };
    expect(defaultPitchForClef(clef, -1)).toEqual({ step: "B", octave: 3 });
  });

  it("bass clef with 15ma ottava returns D5", () => {
    const clef: Clef = { sign: "F", staffPosition: 2 };
    expect(defaultPitchForClef(clef, 2)).toEqual({ step: "D", octave: 5 });
  });

  it("octave clef + ottava stack additively", () => {
    // Treble 8vb clef under 8va ottava: net offset = -1 + 1 = 0
    const clef: Clef = { sign: "G", staffPosition: -2, octave: -1 };
    expect(defaultPitchForClef(clef, 1)).toEqual({ step: "B", octave: 4 });
  });

  it("ottava shift clamps to valid range", () => {
    const clef: Clef = { sign: "G", staffPosition: -2, octave: 2 };
    // B4 + 2 (clef) + 2 (ottava) = B8 — valid
    expect(defaultPitchForClef(clef, 2)).toEqual({ step: "B", octave: 8 });
  });
});

// ── Integration: closestOctave + defaultPitchForClef ──

describe("closestOctave with clef-aware defaults", () => {
  it("first note on treble staff lands in octave 4-5 range", () => {
    const ref = defaultPitchForClef({ sign: "G", staffPosition: -2 }); // B4
    expect(closestOctave("C", ref)).toBe(5); // C closest to B4
    expect(closestOctave("A", ref)).toBe(4); // A closest to B4
    expect(closestOctave("D", ref)).toBe(5); // D closest to B4
    expect(closestOctave("G", ref)).toBe(4); // G closest to B4
  });

  it("first note on bass staff lands in octave 2-3 range", () => {
    const ref = defaultPitchForClef({ sign: "F", staffPosition: 2 }); // D3
    expect(closestOctave("C", ref)).toBe(3); // C closest to D3
    expect(closestOctave("F", ref)).toBe(3); // F closest to D3
    expect(closestOctave("A", ref)).toBe(2); // A2 is 3 steps down (D→C→B→A), A3 is 4 up
    expect(closestOctave("G", ref)).toBe(3); // G3 is 3 steps up (D→E→F→G), G2 is 4 down
  });

  it("first note on treble 8vb staff lands in octave 3-4 range", () => {
    const ref = defaultPitchForClef({ sign: "G", staffPosition: -2, octave: -1 }); // B3
    expect(closestOctave("C", ref)).toBe(4); // C4 closest to B3
    expect(closestOctave("A", ref)).toBe(3); // A3 closest to B3
    expect(closestOctave("F", ref)).toBe(3); // F3 closest to B3
  });

  it("first note on bass 8vb staff (contrabass) lands in octave 1-2 range", () => {
    const ref = defaultPitchForClef({ sign: "F", staffPosition: 2, octave: -1 }); // D2
    expect(closestOctave("C", ref)).toBe(2); // C2 closest to D2
    expect(closestOctave("E", ref)).toBe(2); // E2 closest to D2
    expect(closestOctave("A", ref)).toBe(1); // A1 closest to D2
  });

  it("first note on treble 8va staff lands in octave 5-6 range", () => {
    const ref = defaultPitchForClef({ sign: "G", staffPosition: -2, octave: 1 }); // B5
    expect(closestOctave("C", ref)).toBe(6);
    expect(closestOctave("A", ref)).toBe(5);
  });
});

import { describe, it, expect } from "vitest";
import type { Part } from "@viritura/core";
import {
  kitComponentForPitch,
  kitComponentFromStaffPosition,
  kitComponentsAtStaffPosition,
  trebleStaffPositionForPitch,
} from "../kitInput";

/** A kit where two instruments share staff position 3 (snare + side-stick),
 *  mirroring real imports (e.g. Rhapsody in Blue). Order in the dict is the
 *  cycle order. */
function makePart(): Part {
  return {
    name: "Percussion",
    kit: {
      "kit-crash": { staffPosition: 6, name: "Crash", sound: "s1", notehead: "x" },
      "kit-snare": { staffPosition: 3, name: "Snare", sound: "s2" },
      "kit-stick": { staffPosition: 3, name: "Side Stick", sound: "s3", notehead: "x" },
      "kit-bass": { staffPosition: -1, name: "Bass", sound: "s4" },
    },
    measures: [],
  } as unknown as Part;
}

describe("kitComponentsAtStaffPosition", () => {
  it("returns every component sharing the nearest line, in dict order", () => {
    const part = makePart();
    // Exactly on the shared line.
    expect(kitComponentsAtStaffPosition(part, 3)).toEqual(["kit-snare", "kit-stick"]);
    // Slightly off but still nearest to line 3.
    expect(kitComponentsAtStaffPosition(part, 2)).toEqual(["kit-snare", "kit-stick"]);
  });

  it("returns a single id for a line with one instrument", () => {
    const part = makePart();
    expect(kitComponentsAtStaffPosition(part, 6)).toEqual(["kit-crash"]);
    expect(kitComponentsAtStaffPosition(part, -1)).toEqual(["kit-bass"]);
  });

  it("first element matches the single nearest-pick (cycle starts there)", () => {
    const part = makePart();
    const nearest = kitComponentFromStaffPosition(part, 3);
    expect(kitComponentsAtStaffPosition(part, 3)[0]).toBe(nearest);
  });

  it("cycles deterministically: snare → side-stick → snare", () => {
    const part = makePart();
    const sharing = kitComponentsAtStaffPosition(part, 3);
    const next = (cur: string) => sharing[(sharing.indexOf(cur) + 1) % sharing.length];
    expect(next("kit-snare")).toBe("kit-stick");
    expect(next("kit-stick")).toBe("kit-snare");
  });

  it("returns [] for a part with no kit", () => {
    const part = { name: "Violin", measures: [] } as unknown as Part;
    expect(kitComponentsAtStaffPosition(part, 0)).toEqual([]);
  });
});

/**
 * Percussion staves declare their clef as `{sign:"G", staffPosition:0}` so the
 * percussion glyph renders centered, but the engine reads that same field as
 * the pitch reference — which would place G4, not B4, on the middle line and
 * shift every typed letter down a third. Letter entry reads the staff as
 * treble instead, so these positions are the contract.
 */
describe("trebleStaffPositionForPitch", () => {
  it("places B4 on the middle line, as a treble clef does", () => {
    expect(trebleStaffPositionForPitch({ step: "B", octave: 4 })).toBe(0);
  });

  it("places the treble landmark lines where a reader expects them", () => {
    // E4 bottom line, G4 the line the treble curl names, F5 top line.
    expect(trebleStaffPositionForPitch({ step: "E", octave: 4 })).toBe(-4);
    expect(trebleStaffPositionForPitch({ step: "G", octave: 4 })).toBe(-2);
    expect(trebleStaffPositionForPitch({ step: "F", octave: 5 })).toBe(4);
  });

  it("ignores alteration — a staff line is a line regardless of accidental", () => {
    expect(trebleStaffPositionForPitch({ step: "B", octave: 4, alter: -1 })).toBe(0);
  });
});

describe("kitComponentForPitch", () => {
  it("routes a typed letter to the drum mapped to that treble line", () => {
    const part = makePart();
    // A5 → position 6, the crash line.
    expect(kitComponentForPitch(part, { step: "A", octave: 5 })).toBe("kit-crash");
    // E5 → position 3, the shared snare/side-stick line; snare leads dict order.
    expect(kitComponentForPitch(part, { step: "E", octave: 5 })).toBe("kit-snare");
    // A4 → position -1, the bass drum.
    expect(kitComponentForPitch(part, { step: "A", octave: 4 })).toBe("kit-bass");
  });

  it("snaps a letter between lines to the nearest mapped drum", () => {
    const part = makePart();
    // D5 → position 2, one step from the snare line and four from the crash.
    expect(kitComponentForPitch(part, { step: "D", octave: 5 })).toBe("kit-snare");
  });

  it("returns null for a part with no kit", () => {
    const part = { name: "Violin", measures: [] } as unknown as Part;
    expect(kitComponentForPitch(part, { step: "B", octave: 4 })).toBeNull();
  });
});

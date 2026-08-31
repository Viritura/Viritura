import { describe, it, expect } from "vitest";
import type { Clef, KeySignature } from "@viritura/core";
import {
  staffPositionFromY,
  diatonicFromStaffPosition,
  pitchFromPosition,
  keySignatureAlter,
} from "../pitchFromPosition";

// Standard clefs
const trebleClef: Clef = { sign: "G", staffPosition: -2 };
const bassClef: Clef = { sign: "F", staffPosition: 2 };
const altoClef: Clef = { sign: "C", staffPosition: 0 };

// Key signatures
const cMajor: KeySignature = { fifths: 0 };
const gMajor: KeySignature = { fifths: 1 }; // F#
const dMajor: KeySignature = { fifths: 2 }; // F#, C#
const fMajor: KeySignature = { fifths: -1 }; // Bb
const bbMajor: KeySignature = { fifths: -2 }; // Bb, Eb

describe("staffPositionFromY", () => {
  it("returns 0 for top line", () => {
    expect(staffPositionFromY(100, 100, 10)).toBe(0);
  });

  it("returns 4 for middle line (2 spaces down)", () => {
    expect(staffPositionFromY(120, 100, 10)).toBe(4);
  });

  it("returns 8 for bottom line (4 spaces down)", () => {
    expect(staffPositionFromY(140, 100, 10)).toBe(8);
  });

  it("snaps to nearest half-space", () => {
    // 102 is closer to pos 0 (100) than pos 1 (105)
    expect(staffPositionFromY(102, 100, 10)).toBe(0);
    // 108 is closer to pos 2 (110) than pos 1 (105)
    expect(staffPositionFromY(108, 100, 10)).toBe(2);
  });

  it("handles positions above staff (negative)", () => {
    expect(staffPositionFromY(95, 100, 10)).toBe(-1);
  });
});

describe("diatonicFromStaffPosition", () => {
  describe("treble clef", () => {
    it("top line (pos 0) → F5", () => {
      // F5 diatonic = 5*7+3 = 38
      expect(diatonicFromStaffPosition(0, trebleClef)).toBe(38);
    });

    it("first space (pos 1) → E5", () => {
      expect(diatonicFromStaffPosition(1, trebleClef)).toBe(37);
    });

    it("middle line (pos 4) → B4", () => {
      // B4 diatonic = 4*7+6 = 34
      expect(diatonicFromStaffPosition(4, trebleClef)).toBe(34);
    });

    it("bottom line (pos 8) → E4", () => {
      // E4 diatonic = 4*7+2 = 30
      expect(diatonicFromStaffPosition(8, trebleClef)).toBe(30);
    });

    it("one ledger line below (pos 10) → C4 (middle C)", () => {
      // C4 diatonic = 4*7+0 = 28
      expect(diatonicFromStaffPosition(10, trebleClef)).toBe(28);
    });
  });

  describe("bass clef", () => {
    it("top line (pos 0) → A3", () => {
      // A3 diatonic = 3*7+5 = 26
      expect(diatonicFromStaffPosition(0, bassClef)).toBe(26);
    });

    it("middle line (pos 4) → D3", () => {
      // D3 diatonic = 3*7+1 = 22
      expect(diatonicFromStaffPosition(4, bassClef)).toBe(22);
    });

    it("bottom line (pos 8) → G2", () => {
      // G2 diatonic = 2*7+4 = 18
      expect(diatonicFromStaffPosition(8, bassClef)).toBe(18);
    });

    it("one ledger line above (pos -2) → C4 (middle C)", () => {
      expect(diatonicFromStaffPosition(-2, bassClef)).toBe(28);
    });
  });

  describe("alto clef", () => {
    it("middle line (pos 4) → C4", () => {
      // C4 diatonic = 4*7+0 = 28
      expect(diatonicFromStaffPosition(4, altoClef)).toBe(28);
    });

    it("top line (pos 0) → G4", () => {
      // G4 diatonic = 4*7+4 = 32
      expect(diatonicFromStaffPosition(0, altoClef)).toBe(32);
    });
  });
});

describe("keySignatureAlter", () => {
  it("C major: no alterations", () => {
    expect(keySignatureAlter(cMajor, "C")).toBeUndefined();
    expect(keySignatureAlter(cMajor, "F")).toBeUndefined();
  });

  it("G major: F is sharp", () => {
    expect(keySignatureAlter(gMajor, "F")).toBe(1);
    expect(keySignatureAlter(gMajor, "C")).toBeUndefined();
  });

  it("D major: F and C are sharp", () => {
    expect(keySignatureAlter(dMajor, "F")).toBe(1);
    expect(keySignatureAlter(dMajor, "C")).toBe(1);
    expect(keySignatureAlter(dMajor, "G")).toBeUndefined();
  });

  it("F major: B is flat", () => {
    expect(keySignatureAlter(fMajor, "B")).toBe(-1);
    expect(keySignatureAlter(fMajor, "E")).toBeUndefined();
  });

  it("Bb major: B and E are flat", () => {
    expect(keySignatureAlter(bbMajor, "B")).toBe(-1);
    expect(keySignatureAlter(bbMajor, "E")).toBe(-1);
    expect(keySignatureAlter(bbMajor, "A")).toBeUndefined();
  });
});

describe("pitchFromPosition", () => {
  const sp = 10; // spatium in pixels
  const staffTop = 100;

  describe("treble clef, C major", () => {
    it("middle line → B4", () => {
      const y = staffTop + 4 * (sp / 2); // pos 4
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor);
      expect(pitch).toEqual({ step: "B", octave: 4 });
    });

    it("top space → E5", () => {
      const y = staffTop + 1 * (sp / 2); // pos 1
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor);
      expect(pitch).toEqual({ step: "E", octave: 5 });
    });

    it("top line → F5", () => {
      const y = staffTop; // pos 0
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor);
      expect(pitch).toEqual({ step: "F", octave: 5 });
    });

    it("bottom line → E4", () => {
      const y = staffTop + 8 * (sp / 2); // pos 8
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor);
      expect(pitch).toEqual({ step: "E", octave: 4 });
    });

    it("ledger line below → C4 (middle C)", () => {
      const y = staffTop + 10 * (sp / 2); // pos 10
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor);
      expect(pitch).toEqual({ step: "C", octave: 4 });
    });

    it("ledger line above → A5", () => {
      const y = staffTop - 2 * (sp / 2); // pos -2
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor);
      expect(pitch).toEqual({ step: "A", octave: 5 });
    });
  });

  describe("treble clef with key signatures", () => {
    it("G major: F line → F#5", () => {
      const y = staffTop; // pos 0 = F5 in treble
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, gMajor);
      expect(pitch).toEqual({ step: "F", octave: 5, alter: 1 });
    });

    it("G major: C space → C5 (no alteration)", () => {
      const y = staffTop + 3 * (sp / 2); // pos 3 = C5
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, gMajor);
      expect(pitch).toEqual({ step: "C", octave: 5 });
    });

    it("F major: B space → Bb4", () => {
      const _y = staffTop + 6 * (sp / 2); // pos 6 = A4
      // Actually pos 6 in treble clef: diatonic = 32 + 6 - 6 = 32 = G4? Let me recheck.
      // diatonic = clefRef + (4 - clefLine) * 2 - staffPos
      // = 32 + (4 - 1) * 2 - 6 = 32 + 6 - 6 = 32 = G4
      // Wait, that's G4 not A4. Let me find the correct position for B4.
      // B4 diatonic = 34. pos_from_top = 32 + 6 - 34 = 4. So B4 is pos 4.
      const yB = staffTop + 4 * (sp / 2); // pos 4 = B4
      const pitch = pitchFromPosition(yB, staffTop, sp, trebleClef, fMajor);
      expect(pitch).toEqual({ step: "B", octave: 4, alter: -1 });
    });
  });

  describe("accidental override", () => {
    it("sharp override applies regardless of key", () => {
      const y = staffTop + 4 * (sp / 2); // B4
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor, 1);
      expect(pitch).toEqual({ step: "B", octave: 4, alter: 1 });
    });

    it("natural override cancels key signature", () => {
      const y = staffTop; // F5
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, gMajor, 0);
      // natural override → no alter
      expect(pitch).toEqual({ step: "F", octave: 5 });
    });

    it("flat override", () => {
      const y = staffTop + 2 * (sp / 2); // pos 2 = D5
      const pitch = pitchFromPosition(y, staffTop, sp, trebleClef, cMajor, -1);
      expect(pitch).toEqual({ step: "D", octave: 5, alter: -1 });
    });
  });

  describe("bass clef, C major", () => {
    it("top line → A3", () => {
      const y = staffTop; // pos 0
      const pitch = pitchFromPosition(y, staffTop, sp, bassClef, cMajor);
      expect(pitch).toEqual({ step: "A", octave: 3 });
    });

    it("middle line → D3", () => {
      const y = staffTop + 4 * (sp / 2);
      const pitch = pitchFromPosition(y, staffTop, sp, bassClef, cMajor);
      expect(pitch).toEqual({ step: "D", octave: 3 });
    });

    it("bottom line → G2", () => {
      const y = staffTop + 8 * (sp / 2);
      const pitch = pitchFromPosition(y, staffTop, sp, bassClef, cMajor);
      expect(pitch).toEqual({ step: "G", octave: 2 });
    });
  });

  describe("alto clef, C major", () => {
    it("middle line → C4", () => {
      const y = staffTop + 4 * (sp / 2);
      const pitch = pitchFromPosition(y, staffTop, sp, altoClef, cMajor);
      expect(pitch).toEqual({ step: "C", octave: 4 });
    });

    it("top line → G4", () => {
      const y = staffTop;
      const pitch = pitchFromPosition(y, staffTop, sp, altoClef, cMajor);
      expect(pitch).toEqual({ step: "G", octave: 4 });
    });
  });
});

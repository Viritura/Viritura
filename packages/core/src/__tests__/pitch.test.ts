import { describe, it, expect } from "vitest";
import { diatonicPosition, pitchFromDiatonic, pitchToMidi, stepPitchUp, stepPitchDown } from "../model/pitch";
import type { Pitch } from "../model/pitch";

describe("pitchFromDiatonic", () => {
  it("C4 = diatonic 28", () => {
    const pitch = pitchFromDiatonic(28);
    expect(pitch).toEqual({ step: "C", octave: 4 });
    expect(diatonicPosition(pitch)).toBe(28);
  });

  it("G4 = diatonic 32", () => {
    const pitch = pitchFromDiatonic(32);
    expect(pitch).toEqual({ step: "G", octave: 4 });
    expect(diatonicPosition(pitch)).toBe(32);
  });

  it("B4 = diatonic 34", () => {
    const pitch = pitchFromDiatonic(34);
    expect(pitch).toEqual({ step: "B", octave: 4 });
  });

  it("F5 = diatonic 38", () => {
    const pitch = pitchFromDiatonic(38);
    expect(pitch).toEqual({ step: "F", octave: 5 });
  });

  it("F3 = diatonic 24", () => {
    const pitch = pitchFromDiatonic(24);
    expect(pitch).toEqual({ step: "F", octave: 3 });
  });

  it("round-trips through diatonicPosition", () => {
    for (let d = 0; d <= 63; d++) {
      const pitch = pitchFromDiatonic(d);
      expect(diatonicPosition(pitch)).toBe(d);
    }
  });

  it("preserves alter when provided", () => {
    const pitch = pitchFromDiatonic(38, 1);
    expect(pitch).toEqual({ step: "F", octave: 5, alter: 1 });
  });

  it("omits alter when not provided", () => {
    const pitch = pitchFromDiatonic(28);
    expect(pitch).not.toHaveProperty("alter");
  });

  it("MIDI values match for reconstructed pitches", () => {
    const c4: Pitch = { step: "C", octave: 4 };
    const reconstructed = pitchFromDiatonic(28);
    expect(pitchToMidi(reconstructed)).toBe(pitchToMidi(c4));
  });
});

describe("stepPitchUp", () => {
  it("moves C4 to D4", () => {
    const result = stepPitchUp({ step: "C", octave: 4 });
    expect(result).toEqual({ step: "D", octave: 4 });
  });

  it("moves E4 to F4", () => {
    const result = stepPitchUp({ step: "E", octave: 4 });
    expect(result).toEqual({ step: "F", octave: 4 });
  });

  it("moves B4 to C5 (octave boundary)", () => {
    const result = stepPitchUp({ step: "B", octave: 4 });
    expect(result).toEqual({ step: "C", octave: 5 });
  });

  it("preserves alteration", () => {
    const result = stepPitchUp({ step: "C", octave: 4, alter: 1 });
    expect(result).toEqual({ step: "D", octave: 4, alter: 1 });
  });

  it("clamps octave at 9", () => {
    const result = stepPitchUp({ step: "B", octave: 9 });
    expect(result.octave).toBe(9);
    expect(result.step).toBe("C");
  });
});

describe("stepPitchDown", () => {
  it("moves D4 to C4", () => {
    const result = stepPitchDown({ step: "D", octave: 4 });
    expect(result).toEqual({ step: "C", octave: 4 });
  });

  it("moves F4 to E4", () => {
    const result = stepPitchDown({ step: "F", octave: 4 });
    expect(result).toEqual({ step: "E", octave: 4 });
  });

  it("moves C4 to B3 (octave boundary)", () => {
    const result = stepPitchDown({ step: "C", octave: 4 });
    expect(result).toEqual({ step: "B", octave: 3 });
  });

  it("preserves alteration", () => {
    const result = stepPitchDown({ step: "D", octave: 4, alter: -1 });
    expect(result).toEqual({ step: "C", octave: 4, alter: -1 });
  });

  it("clamps octave at 0", () => {
    const result = stepPitchDown({ step: "C", octave: 0 });
    expect(result.octave).toBe(0);
    expect(result.step).toBe("B");
  });
});

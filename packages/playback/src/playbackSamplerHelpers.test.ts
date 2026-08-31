import { describe, it, expect } from "vitest";
import type { Part } from "@viritura/core";
import { DRUM_KIT_STANDARD, DRUM_KIT_ORCHESTRA, type ISampler } from "@viritura/audio";
import {
  applyDetuneSpread,
  drumKitProgramForSource,
  fixedMidiNoteForPart,
  selectDrumKitProgram,
} from "./playbackSamplerHelpers";
import { resolvePartSounds } from "./soundProfileRuntime";

/** Minimal Part fixture for kit-selection tests (only name + kit matter here). */
function part(name: string, opts: { kit?: boolean } = {}): Part {
  const p: Part = { name, measures: [] };
  if (opts.kit) {
    // One component is enough to make `Object.keys(part.kit).length > 0`.
    p.kit = { c1: { staffPosition: 0 } as NonNullable<Part["kit"]>[string] };
  }

  return p;
}

class DetunableSampler implements ISampler {
  readonly detunes: number[] = [];

  noteOn(): void {}

  noteOff(): void {}

  allNotesOff(): void {}

  setDetune(cents: number): void {
    this.detunes.push(cents);
  }
}

describe("selectDrumKitProgram", () => {
  it("uses the Standard kit when there are no percussion parts", () => {
    expect(selectDrumKitProgram([part("Violin"), part("Flute")])).toBe(DRUM_KIT_STANDARD);
  });

  it("keeps a user-configured kit named 'Percussion' on the Standard kit", () => {
    // Regression: "Percussion" matches the orchestral name regex, but a part
    // with an explicit kit is authored against the GM Standard map — switching
    // it to Orchestra would remap keys 41–53 to chromatic timpani, so a crash
    // or tom would sound a timpani note.
    expect(selectDrumKitProgram([part("Percussion", { kit: true })])).toBe(DRUM_KIT_STANDARD);
  });

  it("keeps an explicit drum-set part on the Standard kit", () => {
    expect(selectDrumKitProgram([part("Drum Set", { kit: true })])).toBe(DRUM_KIT_STANDARD);
  });

  it("uses the Orchestra kit for an orchestral fixed-drum part with no configured kit", () => {
    // "Crash Cymbal" is both a fixed unpitched drum and an orchestral name.
    expect(selectDrumKitProgram([part("Crash Cymbal")])).toBe(DRUM_KIT_ORCHESTRA);
  });

  it("prefers the Standard kit when a configured kit coexists with an orchestral fixed drum", () => {
    expect(selectDrumKitProgram([part("Percussion", { kit: true }), part("Crash Cymbal")])).toBe(DRUM_KIT_STANDARD);
  });
});

describe("drumKitProgramForSource", () => {
  it("prefers a resolved profile percussion-kit program over the legacy score heuristic", () => {
    expect(drumKitProgramForSource({ bankMsb: 128, drumKitProgram: DRUM_KIT_STANDARD }, DRUM_KIT_ORCHESTRA)).toBe(
      DRUM_KIT_STANDARD,
    );
  });

  it("falls back to the legacy score heuristic when a percussion source has no kit program", () => {
    expect(drumKitProgramForSource({ bankMsb: 128 }, DRUM_KIT_ORCHESTRA)).toBe(DRUM_KIT_ORCHESTRA);
  });
});

describe("fixedMidiNoteForPart", () => {
  it("does not collapse a configured kit to its profile's fixed drum key", () => {
    expect(fixedMidiNoteForPart(part("Percussion", { kit: true }), 36)).toBeUndefined();
  });

  it("keeps the fixed key for a single-drum part", () => {
    expect(fixedMidiNoteForPart(part("Bass Drum"), 36)).toBe(36);
  });
});

describe("applyDetuneSpread", () => {
  it("keeps spreading unison parts by their resolved MIDI program", () => {
    const resolved = resolvePartSounds([part("Horn 1"), part("Horn 2"), part("Flute")]);
    const hornOne = new DetunableSampler();
    const hornTwo = new DetunableSampler();
    const flute = new DetunableSampler();

    applyDetuneSpread(
      resolved,
      new Map([
        [0, hornOne],
        [1, hornTwo],
        [2, flute],
      ]),
    );

    expect(hornOne.detunes).toEqual([-3]);
    expect(hornTwo.detunes).toEqual([3]);
    expect(flute.detunes).toEqual([]);
  });
});

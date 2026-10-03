import { describe, expect, it } from "vitest";
import { getCatalogInstrument, INSTRUMENT_CATALOG } from "../../../score/InstrumentCatalog";
import { intervalForSoundingPitch, soundingPitchFor, soundingPitchLabel, transpositionPitchPresets } from "./index";

describe("written C4 sounding pitch", () => {
  it.each([
    [2, 1, "B♭3"],
    [14, 8, "B♭2"],
    [-3, -2, "E♭4"],
    [9, 5, "E♭3"],
    [0, 0, "C4"],
    [0, 1, "B♯3"],
    [12, 7, "C3"],
    [-24, -14, "C6"],
    [1, 0, "C♭4"],
    [1, 1, "B3"],
    [-1, 0, "C♯4"],
    [-1, -1, "D♭4"],
    [60, 35, "C-1"],
  ])("maps MNX (%s, %s) to %s without losing spelling", (halfSteps, staffDistance, label) => {
    expect(soundingPitchLabel(halfSteps, staffDistance)).toBe(label);
    expect(intervalForSoundingPitch(soundingPitchFor(halfSteps, staffDistance))).toEqual({
      halfSteps,
      staffDistance,
    });
  });

  it("round trips unusual intervals and extreme octaves without normalizing them", () => {
    for (let halfSteps = -60; halfSteps <= 60; halfSteps++) {
      for (let staffDistance = -42; staffDistance <= 42; staffDistance++) {
        expect(intervalForSoundingPitch(soundingPitchFor(halfSteps, staffDistance))).toEqual({
          halfSteps,
          staffDistance,
        });
      }
    }
  });
});

describe("instrument-aware notation presets", () => {
  it("uses the actual catalog default for every catalog instrument", () => {
    for (const instrument of INSTRUMENT_CATALOG) {
      expect(transpositionPitchPresets(instrument.id)[0]).toMatchObject({
        id: "catalog-default",
        halfSteps: instrument.transposition?.halfSteps ?? 0,
        staffDistance: instrument.transposition?.staffDistance ?? 0,
      });
    }
  });

  it("distinguishes B-flat horn alto and basso", () => {
    const presets = transpositionPitchPresets("brass.french-horn");
    expect(presets.find((preset) => preset.id === "horn-bb-alto")).toMatchObject({
      label: "Horn in B♭ (alto) — B♭3",
      halfSteps: 2,
      staffDistance: 1,
    });
    expect(presets.find((preset) => preset.id === "horn-bb-basso")).toMatchObject({
      label: "Horn in B♭ (basso) — B♭2",
      halfSteps: 14,
      staffDistance: 8,
    });
  });

  it("keeps E-flat piccolo and alto clarinet separate from instrument identity", () => {
    const instrument = getCatalogInstrument("wind.reed.clarinet.eflat")!;
    const presets = transpositionPitchPresets(instrument.id);
    expect(presets[0]).toMatchObject({ halfSteps: -3, staffDistance: -2 });
    expect(presets.find((preset) => preset.id === "clarinet-eb-piccolo")).toMatchObject({
      label: "Piccolo clarinet in E♭ — E♭4",
      halfSteps: -3,
      staffDistance: -2,
    });
    expect(presets.find((preset) => preset.id === "clarinet-eb-alto")).toMatchObject({
      label: "Alto clarinet in E♭ — E♭3",
      halfSteps: 9,
      staffDistance: 5,
    });
    expect(instrument.transposition).toEqual({ halfSteps: -3, staffDistance: -2 });
  });

  it("does not infer a default or family for unknown instruments", () => {
    expect(transpositionPitchPresets("unknown")).toEqual(transpositionPitchPresets());
    expect(transpositionPitchPresets()).toHaveLength(1);
    expect(transpositionPitchPresets("wind.reed.english-horn")).toHaveLength(2);
  });
});

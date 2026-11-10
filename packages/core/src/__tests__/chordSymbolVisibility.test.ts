import { describe, expect, it } from "vitest";
import { partShowsChordSymbols, type Part } from "../index";

function part(instrumentId?: string): Part {
  return {
    name: "Instrument",
    measures: [],
    ...(instrumentId !== undefined ? { _x: { viritura: { instrumentId } } } : {}),
  };
}

describe("automatic chord-symbol visibility", () => {
  it.each([
    ["keyboard.piano", true],
    ["keyboard.piano.electric", true],
    ["pluck.guitar", true],
    ["pluck.guitar.electric", true],
    ["pluck.bass.electric", true],
    ["strings.contrabass", true],
    ["wind.reed.clarinet.bass", false],
    ["voice.bass", false],
    ["keyboard.organ", false],
    ["keyboard.pianoforte", false],
    ["strings.contrabassoon", false],
    ["unknown", false],
    [undefined, false],
  ] as const)("uses the recognized instrument identity %s", (instrumentId, visible) => {
    const source = part(instrumentId);
    expect(partShowsChordSymbols(source)).toBe(visible);
    source.chordSymbolVisibility = "auto";
    expect(partShowsChordSymbols(source)).toBe(visible);
  });

  it.each([
    ["wind.flutes.flute", "show", true],
    ["keyboard.piano", "hide", false],
    [undefined, "show", true],
    [undefined, "hide", false],
  ] as const)("respects explicit %s / %s", (instrumentId, visibility, visible) => {
    expect(partShowsChordSymbols({ ...part(instrumentId), chordSymbolVisibility: visibility })).toBe(visible);
  });

  it("uses the initial instrument definition when the direct identity is absent", () => {
    const source: Part = {
      ...part(),
      _x: {
        viritura: {
          initialInstrument: "guitar",
          instruments: {
            guitar: { instrumentId: "pluck.guitar.electric" },
            flute: { instrumentId: "wind.flutes.flute" },
          },
        },
      },
    };
    expect(partShowsChordSymbols(source)).toBe(true);
    source._x!.viritura!.initialInstrument = "flute";
    expect(partShowsChordSymbols(source)).toBe(false);
    source._x!.viritura!.initialInstrument = "missing";
    expect(partShowsChordSymbols(source)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseChordSymbolText } from "../operations";

const POSITION = { fraction: [1, 4] as [number, number] };

describe("parseChordSymbolText", () => {
  it.each([
    ["C", { root: { step: "C" }, quality: "major" }],
    ["CM7", { root: { step: "C" }, quality: "major", extension: 7 }],
    ["C6", { root: { step: "C" }, quality: "major", extension: 6 }],
    ["dm", { root: { step: "D" }, quality: "minor" }],
    ["F#maj7", { root: { step: "F", alter: 1 }, quality: "major", extension: 7 }],
    ["Bb7", { root: { step: "B", alter: -1 }, quality: "dominant", extension: 7 }],
    ["C##dim", { root: { step: "C", alter: 2 }, quality: "diminished" }],
    ["Gaug", { root: { step: "G" }, quality: "augmented" }],
    ["Dsus4", { root: { step: "D" }, quality: "suspended4" }],
    ["A5", { root: { step: "A" }, quality: "power" }],
    ["D0", { root: { step: "D" }, quality: "half-diminished", extension: 7 }],
    ["CmMaj7", { root: { step: "C" }, quality: "minor-major", extension: 7 }],
    ["Cadd9", { root: { step: "C" }, quality: "other", kindText: "add9" }],
    ["C7b9", { root: { step: "C" }, quality: "other", kindText: "7b9" }],
    ["C7/E", { root: { step: "C" }, quality: "dominant", extension: 7, bass: { step: "E" } }],
  ])("parses %s", (input, expected) => {
    expect(parseChordSymbolText(input, POSITION)).toEqual({ position: POSITION, ...expected });
  });

  it("preserves the independent staff lane", () => {
    expect(parseChordSymbolText("C", POSITION, 2)).toEqual({
      position: POSITION,
      staff: 2,
      root: { step: "C" },
      quality: "major",
    });
  });

  it.each(["", "H7", "C/E/G"])("rejects unsupported syntax %s", (input) => {
    expect(parseChordSymbolText(input, POSITION)).toBeUndefined();
  });
});

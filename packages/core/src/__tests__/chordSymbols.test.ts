import { describe, expect, it } from "vitest";
import { formatChordSymbolText, parseChordSymbolText, resolveChordSymbol } from "../operations";
import type { ChordQuality, ChordSymbol } from "../model";

const POSITION = { fraction: [1, 4] as [number, number] };

describe("parseChordSymbolText", () => {
  it.each([
    ["C", { root: { step: "C" }, quality: "major" }],
    ["CM7", { root: { step: "C" }, quality: "major", extension: 7 }],
    ["CΔ", { root: { step: "C" }, quality: "major", extension: 7 }],
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
    ["Cadd9", { root: { step: "C" }, quality: "major", kindText: "add9" }],
    ["C7b9", { root: { step: "C" }, quality: "other", kindText: "7b9" }],
    ["C7/E", { root: { step: "C" }, quality: "dominant", extension: 7, bass: { step: "E" } }],
  ])("parses %s", (input, expected) => {
    expect(parseChordSymbolText(input, POSITION)).toEqual({ position: POSITION, rawText: input, ...expected });
  });

  describe("quality text never alters the root", () => {
    it.each(["#5", "b5", "/C"])("does not mistake %s for a known quality", (kindText) => {
      expect(resolveChordSymbol({ position: POSITION, root: { step: "C" }, quality: "power", kindText })).toEqual({
        status: "unsupported",
        message: "Unsupported chord: cannot play this symbol.",
      });
    });
  });

  it.each(["", "H7", "C/E/G", " N.C. "])("preserves unsupported/rootless syntax %s", (input) => {
    expect(parseChordSymbolText(input, POSITION)).toEqual({ position: POSITION, rawText: input });
  });
});

describe("generated chord text", () => {
  const qualities: ChordQuality[] = [
    "major",
    "minor",
    "dominant",
    "diminished",
    "half-diminished",
    "augmented",
    "minor-major",
    "suspended2",
    "suspended4",
    "power",
  ];
  const extensions: ChordSymbol["extension"][] = [undefined, 6, 7, 9, 11, 13];
  it.each(qualities)("preserves all supported %s extensions musically", (quality) => {
    for (const extension of extensions) {
      const chord: ChordSymbol = {
        position: POSITION,
        root: { step: "F", alter: 1 },
        bass: { step: "B", alter: -1 },
        quality,
        extension,
      };
      const resolved = resolveChordSymbol(chord);
      if (resolved.status !== "supported") continue;
      expect(resolveChordSymbol(parseChordSymbolText(formatChordSymbolText(chord), POSITION))).toEqual(resolved);
    }
  });
});

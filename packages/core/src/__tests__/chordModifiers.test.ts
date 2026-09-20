import { describe, expect, it } from "vitest";
import {
  formatChordSymbolText,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  voiceChordSymbol,
} from "../index";

const position = { fraction: [0, 1] as [number, number] };

describe("central chord degree grammar", () => {
  it.each([
    ["Cadd6", [0, 4, 7, 9], "C6"],
    ["Cadd9", [0, 2, 4, 7], "Cadd9"],
    ["Cadd13", [0, 4, 7, 9], "Cadd13"],
    ["Cadd79omit5/E", [0, 2, 4, 10], "Cadd7add9omit5/E"],
    ["C(add7,9,no5)/E", [0, 2, 4, 10], "Cadd7add9omit5/E"],
    ["Cadd(7,9)omit5/E", [0, 2, 4, 10], "Cadd7add9omit5/E"],
    ["C(add7, 9, no5)/E", [0, 2, 4, 10], "Cadd7add9omit5/E"],
    ["C7 (add9, omit5)", [0, 2, 4, 10], "C7add9omit5"],
    ["Cadd791113", [0, 2, 4, 5, 7, 9, 10], "Cadd7add9add11add13"],
    ["C7(add9,omit5)", [0, 2, 4, 10], "C7add9omit5"],
    ["Cmaj7add9", [0, 2, 4, 7, 11], "Cmaj7add9"],
    ["C7sus4", [0, 5, 7, 10], "C7sus4"],
    ["Csus47", [0, 5, 7, 10], "C7sus4"],
    ["Cno3", [0, 7], "Comit3"],
    ["Cdim7omit5", [0, 3, 9], "Cdim7omit5"],
    ["Caugomit5", [0, 4], "Caugomit5"],
    ["Cmaj7omit7", [0, 4, 7], "Cmaj7omit7"],
    ["Cdim13omit7", [0, 2, 3, 5, 6, 9], "Cdim13omit7"],
    ["Csus2add9no2", [0, 2, 7], "Csus2add9omit2"],
    ["Cadd99omit55", [0, 2, 4], "Cadd9omit5"],
    ["Cadd2add4", [0, 2, 4, 5, 7], "Cadd2add4"],
  ] satisfies [string, number[], string][])("resolves and labels %s", (text, pitches, label) => {
    const chord = parseChordSymbolText(text, position);
    const before = structuredClone(chord);
    const resolution = resolveChordSymbol(chord);
    expect(resolution).toMatchObject({ status: "supported", pitchClasses: pitches });
    expect(formatChordSymbolText(chord)).toBe(label);
    expect(resolveChordSymbol(parseChordSymbolText(label, position))).toEqual(resolution);
    expect(resolveChordSymbol({ position, rawText: text })).toEqual(resolution);
    expect(voiceChordSymbol(chord)).toEqual({
      leftHand: [text.endsWith("/E") ? 40 : 36],
      rightHand: pitches.map((pitch) => 60 + pitch),
    });
    expect(chord).toEqual(before);
  });

  it("stores degree intent in the existing schema and transposes roots and bass only", () => {
    const chord = parseChordSymbolText("Cadd79omit5/E", position);
    expect(chord).toEqual({
      position,
      rawText: "Cadd79omit5/E",
      root: { step: "C" },
      quality: "major",
      kindText: "add79omit5",
      bass: { step: "E" },
    });
    const written = transposeChordSymbol(chord, { halfSteps: 2, staffDistance: 1 });
    expect(written).toMatchObject({
      root: { step: "D" },
      bass: { step: "F", alter: 1 },
      rawText: "Dadd79omit5/F#",
      kindText: "add79omit5",
    });
    expect(voiceChordSymbol(written)).toEqual({ leftHand: [42], rightHand: [60, 62, 64, 66] });
  });

  it.each([
    "Cadd",
    "Cadd8",
    "Cadd14",
    "Cadd1",
    "Cadd3",
    "Cadd5",
    "Cadd97alt",
    "Cno",
    "C79",
    "C7(9)",
    "Cadd(9",
    "Cadd9)",
    "C(add9,)",
    "C(add9,,no5)",
    "Cadd((9))",
    "C()",
    "C(add)",
    "Cadd,9",
    "Cadd9()",
    "Cadd9,(",
    "C7b9",
    "C6/9",
    "Cgarbage",
  ])("retains unsupported %s without guessing", (text) => {
    const chord = parseChordSymbolText(text, position);
    expect(chord.rawText).toBe(text);
    expect(resolveChordSymbol(chord)).toEqual({
      status: "unsupported",
      message: "Unsupported chord: cannot play this symbol.",
    });
    expect(voiceChordSymbol(chord)).toEqual({ leftHand: [], rightHand: [] });
  });

  it("does not reinterpret contradictory structured qualities from modifier text", () => {
    const chord = parseChordSymbolText("Cmaj7add9", position);
    expect(resolveChordSymbol({ ...chord, quality: "minor" }).status).toBe("unsupported");
    expect(resolveChordSymbol({ ...chord, textOverride: "C9" }).status).toBe("unsupported");
    expect(resolveChordSymbol({ ...chord, textOverride: "CM7(add9)" }).status).toBe("supported");
  });

  it("checks degree omissions against both equivalent base descriptions", () => {
    const chord = {
      position,
      root: { step: "C" },
      quality: "diminished" as const,
      extension: 6 as const,
      kindText: "dim7omit7",
    };
    expect(resolveChordSymbol(chord).status).toBe("unsupported");
    expect(resolveChordSymbol({ ...chord, kindText: "dim7omit5" })).toMatchObject({
      status: "supported",
      pitchClasses: [0, 3, 9],
    });
  });
});

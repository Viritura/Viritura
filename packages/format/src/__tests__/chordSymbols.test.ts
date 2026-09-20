import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatChordSymbolText,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  voiceChordSymbol,
  type ChordSymbol,
} from "@viritura/core";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { assertRawScore, validateRawScore } from "../mnx/validator";

const position = { fraction: [0, 1] };
const structuredChord = { position, root: { step: "C" }, quality: "major" };

function scoreWithChords(chordSymbols: unknown[]) {
  return {
    mnx: { version: 1 },
    global: { measures: [{ _x: { viritura: { chordSymbols } } }] },
    parts: [{ id: "p1", measures: [{ sequences: [{ content: [] }] }] }],
  };
}

function expectChordRoundtrip(chord: Record<string, unknown>) {
  const source = scoreWithChords([chord]);
  expect(validateRawScore(source).ok).toBe(true);
  const parsed = parseMnx(source);
  expect(parsed.global.measures[0]?.chordSymbols).toEqual([chord]);
  expect(parsed.parts[0]?.measures[0]).not.toHaveProperty("chordSymbols");
  const serialized = serializeMnx(parsed);
  assertRawScore(serialized);
  expect(serialized).toHaveProperty("global.measures.0._x.viritura.chordSymbols", [chord]);
  expect(serialized.global.measures[0]).not.toHaveProperty("chordSymbols");
  expect(serialized.parts[0]?.measures[0]).not.toHaveProperty("_x.viritura.chordSymbols");
  expect(parseMnx(serialized)).toEqual(parsed);
}

function expectRejected(source: unknown) {
  expect(validateRawScore(source).ok).toBe(false);
  expect(() => parseMnx(source)).toThrow();
}

describe("central chord-symbol contract", () => {
  const modifierCases: {
    text: string;
    quality: ChordSymbol["quality"];
    extension?: ChordSymbol["extension"];
    kindText?: string;
    label: string;
    rightHand: number[];
  }[] = [
    { text: "Cadd6", quality: "major", extension: 6, label: "C6", rightHand: [60, 64, 67, 69] },
    { text: "C6", quality: "major", extension: 6, label: "C6", rightHand: [60, 64, 67, 69] },
    { text: "Csus47", quality: "suspended4", extension: 7, label: "C7sus4", rightHand: [60, 65, 67, 70] },
    { text: "C7sus4", quality: "suspended4", extension: 7, label: "C7sus4", rightHand: [60, 65, 67, 70] },
    {
      text: "Cadd79omit5/E",
      quality: "major",
      kindText: "add79omit5",
      label: "Cadd7add9omit5/E",
      rightHand: [60, 62, 64, 70],
    },
    {
      text: "C(add7,9,no5)/E",
      quality: "major",
      kindText: "(add7,9,no5)",
      label: "Cadd7add9omit5/E",
      rightHand: [60, 62, 64, 70],
    },
    {
      text: "Cadd(7,9)omit5/E",
      quality: "major",
      kindText: "add(7,9)omit5",
      label: "Cadd7add9omit5/E",
      rightHand: [60, 62, 64, 70],
    },
    {
      text: "C7(add9,omit5)",
      quality: "dominant",
      extension: 7,
      kindText: "7(add9,omit5)",
      label: "C7add9omit5",
      rightHand: [60, 62, 64, 70],
    },
    {
      text: "Cmaj7add9",
      quality: "major",
      extension: 7,
      kindText: "maj7add9",
      label: "Cmaj7add9",
      rightHand: [60, 62, 64, 67, 71],
    },
    {
      text: "Cadd791113",
      quality: "major",
      kindText: "add791113",
      label: "Cadd7add9add11add13",
      rightHand: [60, 62, 64, 65, 67, 69, 70],
    },
  ];

  it.each(modifierCases)(
    "round-trips entered $text through the wire schema, interpretation, and transposition",
    ({ text, quality, extension, kindText, label, rightHand }) => {
      const rawText = `  ${text}\t`;
      const entered = parseChordSymbolText(rawText, { fraction: [0, 1] });
      const score = parseMnx(scoreWithChords([]));
      score.global.measures[0]!.chordSymbols = [entered];
      const serialized = serializeMnx(score);
      assertRawScore(serialized);
      const restored = parseMnx(serialized).global.measures[0]!.chordSymbols![0]!;
      expect(restored).toEqual(entered);
      expect(restored).toMatchObject({ root: { step: "C" }, quality, rawText });
      expect(restored.extension).toBe(extension);
      if (kindText !== undefined) expect(restored.kindText).toBe(kindText);
      expect(restored).not.toHaveProperty("textOverride");
      const hasBass = text.endsWith("/E");
      expect(restored.bass).toEqual(hasBass ? { step: "E" } : undefined);
      expect(resolveChordSymbol(restored)).toEqual({
        status: "supported",
        rootPitchClass: 0,
        bassPitchClass: hasBass ? 4 : 0,
        pitchClasses: rightHand.map((pitch) => pitch - 60),
      });
      expect(formatChordSymbolText(restored)).toBe(label);
      expect(voiceChordSymbol(restored)).toEqual({ leftHand: [hasBass ? 40 : 36], rightHand });

      const written = transposeChordSymbol(restored, { halfSteps: 2, staffDistance: 1 });
      expect(written.root).toEqual({ step: "D" });
      expect(written.bass).toEqual(hasBass ? { step: "F", alter: 1 } : undefined);
      expect(written.rawText).toBe(rawText.replace("C", "D").replace("/E", "/F#"));
      expect(written.kindText).toBe(restored.kindText);
      expect(formatChordSymbolText(written)).toBe(label.replace("C", "D").replace("/E", "/F#"));
      expect(voiceChordSymbol(written)).toEqual({
        leftHand: [hasBass ? 42 : 38],
        rightHand: rightHand.map((pitch) => 60 + ((pitch - 60 + 2) % 12)).sort((a, b) => a - b),
      });
      expect(transposeChordSymbol(written, { halfSteps: -2, staffDistance: -1 })).toEqual(restored);
      expect(serializeMnx(score)).toEqual(serialized);
    },
  );

  it.each([
    "C7(9)",
    "C79",
    "C7b9",
    "Caddb9",
    "Cadd#11",
    "Cadd8",
    "Cadd1",
    "Comit8",
    "C(add7",
    "Cadd(7,9",
    "Cadd7)",
    "C((add9))",
    "C(add(7,9))",
    "C()",
    "Cadd()",
    "C(add7,,9)",
    "C(add7,)",
    "C(,add7)",
    "Cadd",
    "Comit",
    "Cno",
    "Cadd9mystery",
  ])("preserves unsupported grammar %s and its diagnostic without changing the wire schema", (text) => {
    const entered = parseChordSymbolText(` ${text} `, { fraction: [0, 1] });
    const score = parseMnx(scoreWithChords([]));
    score.global.measures[0]!.chordSymbols = [entered];
    const serialized = serializeMnx(score);
    assertRawScore(serialized);
    const restored = parseMnx(serialized).global.measures[0]!.chordSymbols![0]!;
    expect(restored).toEqual(entered);
    expect(resolveChordSymbol(restored)).toEqual({
      status: "unsupported",
      message: "Unsupported chord: cannot play this symbol.",
    });
    expect(formatChordSymbolText(restored)).toBe(` ${text} `);
    expect(voiceChordSymbol(restored)).toEqual({ leftHand: [], rightHand: [] });
  });

  it("preserves imported structured modifiers without needing raw text or rewriting the base harmony", () => {
    const imported = {
      ...structuredChord,
      extension: 7,
      kindText: "maj7(add9,omit5)",
      bass: { step: "E" },
    };
    expectChordRoundtrip(imported);
    const stored = parseMnx(scoreWithChords([imported])).global.measures[0]!.chordSymbols![0]!;
    expect(stored).not.toHaveProperty("rawText");
    expect(formatChordSymbolText(stored)).toBe("Cmaj7add9omit5/E");
    expect(voiceChordSymbol(stored)).toEqual({ leftHand: [40], rightHand: [60, 62, 64, 71] });
  });

  it("does not reparse contradictory imported structured harmony from modifier provenance", () => {
    const imported = { ...structuredChord, rawText: "Cadd79omit5/E", kindText: "add79omit5", bass: { step: "F" } };
    expectChordRoundtrip(imported);
    const stored = parseMnx(scoreWithChords([imported])).global.measures[0]!.chordSymbols![0]!;
    expect(resolveChordSymbol(stored).status).toBe("unsupported");
    expect(voiceChordSymbol(stored)).toEqual({ leftHand: [], rightHand: [] });
  });

  it.each([
    ["M7", "major", 7, "Cmaj7/E"],
    ["min7", "minor", 7, "Cm7/E"],
    ["°7", "diminished", 7, "Cdim7/E"],
    ["+", "augmented", undefined, "Caug/E"],
    ["m7b5", "half-diminished", 7, "Cø7/E"],
    ["mΔ", "minor-major", 7, "CmMaj7/E"],
    ["sus", "suspended4", undefined, "Csus4/E"],
  ])("keeps %s provenance in storage without creating a visual override", (alias, quality, extension, label) => {
    const chord = {
      position,
      root: { step: "C" },
      bass: { step: "E" },
      quality,
      ...(extension === undefined ? {} : { extension }),
      rawText: `C${alias}/E`,
      kindText: alias,
    };
    expectChordRoundtrip(chord);
    const parsed = parseMnx(scoreWithChords([chord]));
    const stored = parsed.global.measures[0]!.chordSymbols![0]!;
    expect(stored).not.toHaveProperty("textOverride");
    expect(resolveChordSymbol(stored).status).toBe("supported");
    expect(formatChordSymbolText(stored)).toBe(label);
  });

  it("keeps concert storage unchanged when a render context transposes an alias copy", () => {
    const chord = {
      ...structuredChord,
      extension: 7,
      bass: { step: "E" },
      rawText: "CM7/E",
      kindText: "M7",
    };
    const parsed = parseMnx(scoreWithChords([chord]));
    const stored = parsed.global.measures[0]!.chordSymbols![0]!;
    const written = transposeChordSymbol(stored, { halfSteps: 2, staffDistance: 1 });
    expect(written).toMatchObject({ root: { step: "D" }, bass: { step: "F", alter: 1 }, rawText: "DM7/F#" });
    expect(written).not.toHaveProperty("textOverride");
    expect(stored).toEqual(chord);
    expect(serializeMnx(parsed)).toHaveProperty("global.measures.0._x.viritura.chordSymbols", [chord]);
    expect(formatChordSymbolText(written)).toBe("Dmaj7/F#");
  });

  it.each(["cM7/e", "", "custom label"])(
    "retains explicit authored override %j rather than normalizing it",
    (textOverride) => {
      const chord = { ...structuredChord, extension: 7, rawText: "CM7", kindText: "M7", textOverride };
      expectChordRoundtrip(chord);
      const parsed = parseMnx(scoreWithChords([chord]));
      expect(formatChordSymbolText(parsed.global.measures[0]!.chordSymbols![0]!)).toBe(textOverride);
    },
  );

  it("retains unsupported raw text and its diagnostic across serialization", () => {
    const chord = { ...structuredChord, quality: "other", kindText: "7alt", rawText: "  C7alt  " };
    expectChordRoundtrip(chord);
    const parsed = parseMnx(scoreWithChords([chord]));
    const restored = parseMnx(serializeMnx(parsed)).global.measures[0]!.chordSymbols![0]!;
    expect(restored).not.toHaveProperty("textOverride");
    expect(resolveChordSymbol(restored).status).toBe("unsupported");
    expect(formatChordSymbolText(restored)).toBe(chord.rawText);
  });

  it("round-trips a structured root without inventing an optional quality or raw text", () => {
    expectChordRoundtrip({ position, root: { step: "C" } });
  });

  it("preserves structured spelling, bass, extension, and a visual override", () => {
    expectChordRoundtrip({
      position: { fraction: [3, 8] },
      root: { step: "F", alter: 1 },
      quality: "other",
      kindText: "Neapolitan",
      bass: { step: "B", alter: -1 },
      extension: 9,
      textOverride: "visual label, not harmonic input",
    });
  });

  it.each([6, 7, 9, 11, 13])("retains supported extension %s", (extension) => {
    expectChordRoundtrip({ ...structuredChord, extension });
  });

  it.each(["Cmaj7", "  D♭maj7/F \t", "C7(", "not a recognized chord", "NC", "N.C.", "  NC  ", "", " \t "])(
    "round-trips rootless authored text %j without resolving it",
    (rawText) => {
      expectChordRoundtrip({ position, rawText });
    },
  );

  it.each(["  d♭MAJ7 / f  ", "G7", "C7(", "NC"])(
    "preserves raw text %j exactly alongside a structured root without checking semantic agreement",
    (rawText) => {
      expectChordRoundtrip({ ...structuredChord, rawText });
    },
  );

  it("does not replace raw text with the visual override", () => {
    expectChordRoundtrip({ position, rawText: "  NC  ", textOverride: "tacet" });
  });

  it("retains explicitly empty authored visual fields", () => {
    expectChordRoundtrip({ ...structuredChord, kindText: "", textOverride: "" });
  });

  it("keeps global chord ordering and positions without copying events into parts", () => {
    const chords = [
      { position: { fraction: [3, 4] }, rawText: "G7" },
      { position, root: { step: "C" } },
      { position, rawText: "NC" },
    ];
    const source = scoreWithChords(chords);
    source.parts.push({ id: "p2", measures: [{ sequences: [{ content: [] }] }] });
    const parsed = parseMnx(source);
    expect(parsed.global.measures[0]?.chordSymbols).toEqual(chords);
    const serialized = serializeMnx(parsed);
    assertRawScore(serialized);
    expect(serialized).toHaveProperty("global.measures.0._x.viritura.chordSymbols", chords);
    for (const part of parsed.parts) {
      expect(part.measures[0]).not.toHaveProperty("chordSymbols");
    }
    for (const part of serialized.parts) {
      expect(part.measures[0]).not.toHaveProperty("_x.viritura.chordSymbols");
    }
    expect(parseMnx(serialized)).toEqual(parsed);
  });

  it("uses only global measures in the local authored fixture", () => {
    const source: unknown = JSON.parse(
      readFileSync(resolve(__dirname, "../../fixtures/mnx/chord-symbols.mnx"), "utf8"),
    );
    expect(validateRawScore(source).ok).toBe(true);
    const parsed = parseMnx(source);
    expect(parsed.global.measures.map((measure) => measure.chordSymbols?.length)).toEqual([4, 3, 3, 2]);
    for (const part of parsed.parts) {
      for (const measure of part.measures) {
        expect(measure).not.toHaveProperty("chordSymbols");
      }
    }
    expect(parseMnx(serializeMnx(parsed))).toEqual(parsed);
  });

  it.each([
    ["neither root nor rawText", { position }],
    ["quality without root or rawText", { position, quality: "major" }],
    ["bass without root or rawText", { position, bass: { step: "C" } }],
    ["visual override without root or rawText", { position, textOverride: "Cmaj7" }],
    ["missing position with root", { root: { step: "C" } }],
    ["missing position with rawText", { rawText: "NC" }],
  ])("rejects %s", (_name, chord) => {
    expectRejected(scoreWithChords([chord]));
  });

  it.each([
    ["root missing step", { root: {} }],
    ["invalid root step", { root: { step: "H" } }],
    ["lowercase root step", { root: { step: "c" } }],
    ["noninteger root alteration", { root: { step: "C", alter: 0.5 } }],
    ["string root alteration", { root: { step: "C", alter: "1" } }],
    ["unexpected root octave", { root: { step: "C", octave: 4 } }],
    ["null root", { root: null }],
    ["bass missing step", { bass: {} }],
    ["invalid bass step", { bass: { step: "H" } }],
    ["noninteger bass alteration", { bass: { step: "G", alter: 0.5 } }],
    ["unexpected bass octave", { bass: { step: "G", octave: 3 } }],
    ["invalid quality", { quality: "invented" }],
    ["null quality", { quality: null }],
    ["unsupported extension", { extension: 8 }],
    ["noninteger extension", { extension: 7.5 }],
    ["string extension", { extension: "7" }],
    ["missing fraction", { position: {} }],
    ["short fraction", { position: { fraction: [0] } }],
    ["long fraction", { position: { fraction: [0, 1, 2] } }],
    ["noninteger numerator", { position: { fraction: [0.5, 1] } }],
    ["noninteger denominator", { position: { fraction: [0, 1.5] } }],
    ["unsafe numerator", { position: { fraction: [Number.MAX_SAFE_INTEGER + 1, 4] } }],
    ["unsafe denominator", { position: { fraction: [0, Number.MAX_SAFE_INTEGER + 1] } }],
    ["negative numerator", { position: { fraction: [-1, 4] } }],
    ["zero denominator", { position: { fraction: [0, 0] } }],
    ["negative denominator", { position: { fraction: [0, -4] } }],
    ["string fraction component", { position: { fraction: [0, "1"] } }],
    ["nonarray fraction", { position: { fraction: "0/1" } }],
    ["unexpected position field", { position: { fraction: [0, 1], staff: 1 } }],
    ["null rawText", { rawText: null }],
    ["numeric rawText", { rawText: 7 }],
    ["nonstring kindText", { kindText: 7 }],
    ["nonstring textOverride", { textOverride: 7 }],
    ["unknown chord field", { invented: true }],
  ])("rejects malformed structural fields: %s even with raw text", (_name, fields) => {
    expectRejected(scoreWithChords([{ ...structuredChord, rawText: "Cmaj7", ...fields }]));
  });

  it.each(["displayStaff", "staff"])("rejects removed per-chord %s at the global wire location", (field) => {
    expectRejected(scoreWithChords([{ ...structuredChord, [field]: 1 }]));
  });

  it.each([{ chordSymbols: [] }, { chordSymbols: [structuredChord] }])(
    "rejects removed part-measure chordSymbols $chordSymbols without migration",
    ({ chordSymbols }) => {
      const source = {
        ...scoreWithChords([structuredChord]),
        parts: [
          {
            id: "p1",
            measures: [{ sequences: [{ content: [] }], _x: { viritura: { chordSymbols } } }],
          },
        ],
      };
      expectRejected(source);
    },
  );

  it.each(["chordSymbolVisibility", "globalChordSymbolVisibility"])(
    "rejects removed layout-staff %s at its wire location",
    (field) => {
      expectRejected({
        ...scoreWithChords([structuredChord]),
        layouts: [
          {
            id: "full",
            content: [
              {
                type: "staff",
                sources: [{ part: "p1" }],
                _x: { viritura: { [field]: "show" } },
              },
            ],
          },
        ],
      });
    },
  );
});

describe("source-part chord-symbol visibility", () => {
  it.each(["auto", "show", "hide"])("hoists and round-trips explicit %s without omitting auto", (visibility) => {
    const source = {
      ...scoreWithChords([structuredChord]),
      parts: [
        {
          id: "p1",
          measures: [{ sequences: [{ content: [] }] }],
          _x: { viritura: { chordSymbolVisibility: visibility } },
        },
      ],
    };
    expect(validateRawScore(source).ok).toBe(true);
    const parsed = parseMnx(source);
    expect(parsed.parts[0]?.chordSymbolVisibility).toBe(visibility);
    const serialized = serializeMnx(parsed);
    assertRawScore(serialized);
    expect(serialized).toHaveProperty("parts.0._x.viritura.chordSymbolVisibility", visibility);
    expect(serialized.parts[0]).not.toHaveProperty("chordSymbolVisibility");
    expect(parseMnx(serialized)).toEqual(parsed);
  });

  it("leaves absent visibility absent rather than materializing auto", () => {
    const parsed = parseMnx(scoreWithChords([structuredChord]));
    expect(parsed.parts[0]?.chordSymbolVisibility).toBeUndefined();
    expect(serializeMnx(parsed)).not.toHaveProperty("parts.0._x.viritura.chordSymbolVisibility");
  });

  it("merges edited visibility with retained instrument identity and spatial placement", () => {
    const identity = { instrumentId: "piano", midiProgram: 0, family: "keyboard", spatial: { x: 1, y: 2 } };
    const source = {
      ...scoreWithChords([structuredChord]),
      parts: [
        {
          id: "p1",
          measures: [{ sequences: [{ content: [] }] }],
          _x: { viritura: { ...identity, chordSymbolVisibility: "show" } },
        },
      ],
    };
    const parsed = parseMnx(source);
    expect(parsed.parts[0]?._x?.viritura).toEqual(identity);
    parsed.parts[0]!.chordSymbolVisibility = "hide";
    const serialized = serializeMnx(parsed);
    expect(serialized).toHaveProperty("parts.0._x.viritura", { ...identity, chordSymbolVisibility: "hide" });
    expect(parseMnx(serialized)).toEqual(parsed);
    delete parsed.parts[0]!.chordSymbolVisibility;
    expect(serializeMnx(parsed)).toHaveProperty("parts.0._x.viritura", identity);
  });

  it.each(["always", "AUTO", "", null, 1, true, {}, []].map((visibility) => ({ visibility })))(
    "rejects invalid source-part visibility $visibility",
    ({ visibility }) => {
      expectRejected({
        ...scoreWithChords([structuredChord]),
        parts: [
          {
            id: "p1",
            measures: [{ sequences: [{ content: [] }] }],
            _x: { viritura: { chordSymbolVisibility: visibility } },
          },
        ],
      });
    },
  );
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";

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
    expect(serialized).toHaveProperty("parts.0._x.viritura.chordSymbolVisibility", visibility);
    expect(serialized.parts[0]).not.toHaveProperty("chordSymbolVisibility");
    expect(parseMnx(serialized)).toEqual(parsed);
  });

  it("leaves absent visibility absent rather than materializing auto", () => {
    const parsed = parseMnx(scoreWithChords([structuredChord]));
    expect(parsed.parts[0]?.chordSymbolVisibility).toBeUndefined();
    expect(serializeMnx(parsed).parts[0]).not.toHaveProperty("_x.viritura.chordSymbolVisibility");
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

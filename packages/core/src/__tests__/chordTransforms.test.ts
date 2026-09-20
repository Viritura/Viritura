import { describe, expect, it } from "vitest";
import {
  compareChordSymbolPositions,
  formatChordSymbolText,
  mergeGlobalChordSymbols,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  upsertGlobalChordSymbol,
  type ChordSymbol,
  type ChordSymbolConflict,
  type ChordSymbolSource,
  type GlobalMeasure,
  type Interval,
  type RhythmicPosition,
} from "../index";

function position(numerator = 0, denominator = 1, graceIndex?: number): RhythmicPosition {
  return { fraction: [numerator, denominator], ...(graceIndex === undefined ? {} : { graceIndex }) };
}

function chord(text: string, onset = position()): ChordSymbol {
  return parseChordSymbolText(text, onset);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function conflict(onset: RhythmicPosition, kept: number, discarded: number): ChordSymbolConflict {
  return {
    position: onset,
    keptPartIndex: kept,
    discardedPartIndex: discarded,
    message: "Conflicting chord symbols: kept the topmost source part.",
  };
}

const MAX = Number.MAX_SAFE_INTEGER;
const INVALID_NUMBERS = [
  { name: "fractional", value: 0.5 },
  { name: "unsafe positive", value: MAX + 1 },
  { name: "unsafe negative", value: -MAX - 1 },
  { name: "NaN", value: Number.NaN },
  { name: "positive infinity", value: Number.POSITIVE_INFINITY },
  { name: "negative infinity", value: Number.NEGATIVE_INFINITY },
];
const INVALID_POSITIONS = [
  ...INVALID_NUMBERS.flatMap(({ name, value }) => [
    { name: `${name} numerator`, onset: position(value, 4) },
    { name: `${name} denominator`, onset: position(1, value) },
    { name: `${name} grace index`, onset: position(1, 4, value) },
  ]),
  { name: "negative numerator", onset: position(-1, 4) },
  { name: "negative denominator", onset: position(1, -4) },
  { name: "zero denominator", onset: position(1, 0) },
  { name: "zero over zero", onset: position(0, 0) },
  { name: "negative grace index", onset: position(1, 4, -1) },
];

describe("transposeChordSymbol", () => {
  const spellings: { text: string; interval: Interval; expected: string }[] = [
    { text: "C/E", interval: { staffDistance: 1, halfSteps: 2 }, expected: "D/F#" },
    { text: "C/E", interval: { staffDistance: -1, halfSteps: -2 }, expected: "Bb/D" },
    { text: "B/D#", interval: { staffDistance: 1, halfSteps: 1 }, expected: "C/E" },
    { text: "C/E", interval: { staffDistance: -1, halfSteps: -1 }, expected: "B/D#" },
    { text: "F#/A#", interval: { staffDistance: 1, halfSteps: 2 }, expected: "G#/B#" },
    { text: "C/E", interval: { staffDistance: 0, halfSteps: 1 }, expected: "C#/E#" },
    { text: "C/E", interval: { staffDistance: 0, halfSteps: -1 }, expected: "Cb/Eb" },
    { text: "C#/E#", interval: { staffDistance: 1, halfSteps: 0 }, expected: "Db/F" },
    { text: "Db/F", interval: { staffDistance: -1, halfSteps: 0 }, expected: "C#/E#" },
    { text: "F#/A#", interval: { staffDistance: 1, halfSteps: 3 }, expected: "G##/B##" },
    { text: "Eb/Gb", interval: { staffDistance: -1, halfSteps: -3 }, expected: "Dbb/Fbb" },
    { text: "C##/Ebb", interval: { staffDistance: 1, halfSteps: 2 }, expected: "D##/Fb" },
    { text: "C##/Ebb", interval: { staffDistance: -1, halfSteps: -2 }, expected: "B#/Dbb" },
    { text: "Cb/Ebb", interval: { staffDistance: 7, halfSteps: 12 }, expected: "Cb/Ebb" },
    { text: "C##/E#", interval: { staffDistance: -7, halfSteps: -12 }, expected: "C##/E#" },
    { text: "B/D#", interval: { staffDistance: 8, halfSteps: 14 }, expected: "C#/E#" },
    { text: "C/E", interval: { staffDistance: -8, halfSteps: -14 }, expected: "Bb/D" },
    { text: "F#/A#", interval: { staffDistance: 15, halfSteps: 26 }, expected: "G#/B#" },
    { text: "C/E", interval: { staffDistance: -15, halfSteps: -26 }, expected: "Bb/D" },
  ];

  it.each(spellings)("spells both $text roots with $interval as $expected", ({ text, interval, expected }) => {
    const original = freeze(chord(text, position(3, 8, 2)));
    const snapshot = structuredClone(original);
    const result = transposeChordSymbol(original, freeze(interval));
    expect(result).toEqual(chord(expected, original.position));
    expect(result).not.toBe(original);
    expect(original).toEqual(snapshot);
  });

  it.each(spellings)("round-trips spelled $text with $interval", ({ text, interval }) => {
    const original = freeze(chord(text));
    const inverse = { staffDistance: -interval.staffDistance, halfSteps: -interval.halfSteps };
    expect(transposeChordSymbol(transposeChordSymbol(original, interval), inverse)).toEqual(original);
  });

  it("transposes structured roots without adding raw text or a display override", () => {
    const original: ChordSymbol = freeze({
      position: position(1, 8),
      root: { step: "B", alter: -1 },
      bass: { step: "D" },
      quality: "minor",
      extension: 9,
      kindText: "min9",
    });
    expect(transposeChordSymbol(original, { staffDistance: 2, halfSteps: 4 })).toEqual({
      ...original,
      root: { step: "D" },
      bass: { step: "F", alter: 1 },
    });
  });

  it.each([
    ["C𝄪m/E𝄫", "D##m/Fb"],
    ["C♯maj7/G♯", "D#maj7/A#"],
    ["B♭7/D♭", "C7/Eb"],
    ["cx/Gbb", "D##/Abb"],
  ])("transposes authored accidental spelling %s to %s", (text, expected) => {
    const original = freeze({ ...chord(text), textOverride: text });
    const result = transposeChordSymbol(original, { staffDistance: 1, halfSteps: 2 });
    expect(result).toEqual({ ...chord(expected), textOverride: expected });
  });

  it("preserves unsupported suffixes, whitespace, positions and independent override spelling", () => {
    const original = freeze({
      ...chord(" \tC7(b9)/E  ", position(2, 3, 0)),
      textOverride: "\tDbadd9/Ab ",
    });
    const snapshot = structuredClone(original);
    const result = transposeChordSymbol(original, { staffDistance: 1, halfSteps: 2 });
    expect(result).toEqual({
      ...original,
      root: { step: "D" },
      bass: { step: "F", alter: 1 },
      rawText: " \tD7(b9)/F#  ",
      textOverride: "\tEbadd9/Bb ",
    });
    expect(result.kindText).toBe("7(b9)");
    expect(result.quality).toBe("other");
    expect(resolveChordSymbol(result).status).toBe("unsupported");
    expect(original).toEqual(snapshot);
  });

  it.each(["", "H7", "C/E/G", " N.C. ", "NC", "n.c", "C/"])(
    "retains rootless NC or malformed text %j verbatim",
    (text) => {
      const original: ChordSymbol = freeze({ position: position(), rawText: text, textOverride: text });
      expect(transposeChordSymbol(original, { staffDistance: -8, halfSteps: -14 })).toEqual(original);
    },
  );

  it("transposes recognizable raw-only harmony without inventing structured fields", () => {
    const original: ChordSymbol = freeze({ position: position(), rawText: "Cbadd9/Gb" });
    expect(transposeChordSymbol(original, { staffDistance: 1, halfSteps: 2 })).toEqual({
      position: position(),
      rawText: "Dbadd9/Ab",
    });
  });

  it("leaves malformed raw/override text intact while transposing structured harmony", () => {
    const original: ChordSymbol = freeze({
      position: position(),
      root: { step: "C" },
      bass: { step: "E" },
      rawText: "C/E/G",
      textOverride: "H7",
    });
    expect(transposeChordSymbol(original, { staffDistance: 1, halfSteps: 2 })).toEqual({
      ...original,
      root: { step: "D" },
      bass: { step: "F", alter: 1 },
    });
  });

  it("keeps an empty override empty", () => {
    const original = freeze({ ...chord("C/E"), textOverride: "" });
    expect(transposeChordSymbol(original, { staffDistance: 1, halfSteps: 2 })).toEqual({
      ...chord("D/F#"),
      textOverride: "",
    });
  });

  it("preserves a zero interval exactly, including authored Unicode and explicit natural alterations", () => {
    const original: ChordSymbol = freeze({
      position: position(2, 8, 0),
      root: { step: "C", alter: 0 },
      bass: { step: "E", alter: -2 },
      quality: "other",
      kindText: "add9",
      rawText: " cadd9/E𝄫 ",
      textOverride: "Cadd9/E♭♭",
    });
    const result = transposeChordSymbol(original, freeze({ staffDistance: 0, halfSteps: 0 }));
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
  });

  it.each(INVALID_NUMBERS)("rejects $name interval components, even on silent input", ({ value }) => {
    for (const original of [chord("C/E"), chord("NC")]) {
      expect(() => transposeChordSymbol(original, { staffDistance: value, halfSteps: 0 })).toThrow(RangeError);
      expect(() => transposeChordSymbol(original, { staffDistance: 0, halfSteps: value })).toThrow(RangeError);
    }
  });
});

describe("formatChordSymbolText", () => {
  it.each([
    [" cM7/e ", "Cmaj7/E", "Dmaj7/F#"],
    ["Cmin7/E", "Cm7/E", "Dm7/F#"],
    ["C°7/E", "Cdim7/E", "Ddim7/F#"],
    ["C+/E", "Caug/E", "Daug/F#"],
    ["Cm7b5/E", "Cø7/E", "Dø7/F#"],
    ["CmΔ/E", "CmMaj7/E", "DmMaj7/F#"],
    ["Csus/E", "Csus4/E", "Dsus4/F#"],
  ])("formats supported alias %s semantically without rewriting storage", (rawText, concertLabel, writtenLabel) => {
    const original = freeze(chord(rawText));
    const snapshot = structuredClone(original);
    const written = transposeChordSymbol(original, { halfSteps: 2, staffDistance: 1 });
    expect(formatChordSymbolText(original)).toBe(concertLabel);
    expect(formatChordSymbolText(written)).toBe(writtenLabel);
    expect(original).toEqual(snapshot);
    expect(written).not.toHaveProperty("textOverride");
  });

  it("formats supported raw-only labels without persisting inferred structure", () => {
    const original = freeze({ position: position(), rawText: "CM7/E" });
    expect(formatChordSymbolText(original)).toBe("Cmaj7/E");
    expect(formatChordSymbolText(transposeChordSymbol(original, { halfSteps: 2, staffDistance: 1 }))).toBe("Dmaj7/F#");
    expect(original).toEqual({ position: position(), rawText: "CM7/E" });
  });

  it("retains unsupported kind text even beside otherwise supported structure", () => {
    const original = freeze({ ...chord("C7/E"), kindText: "7alt", rawText: " C7alt/E " });
    expect(formatChordSymbolText(original)).toBe(" C7alt/E ");
  });

  it.each(["7alt", "min7"])("retains conflicting kind text %s when no raw fallback exists", (kindText) => {
    const original: ChordSymbol = freeze({
      position: position(),
      root: { step: "C" },
      bass: { step: "E" },
      quality: "major",
      kindText,
    });
    expect(resolveChordSymbol(original).status).toBe("unsupported");
    expect(formatChordSymbolText(original)).toBe(`C${kindText}/E`);
    expect(formatChordSymbolText(transposeChordSymbol(original, { halfSteps: 2, staffDistance: 1 }))).toBe(
      `D${kindText}/F#`,
    );
  });

  it.each(["Custom display", "", " N.C. "])("prefers the override %j over raw and generated text", (textOverride) => {
    const original = freeze({ ...chord("C7/E"), textOverride });
    const snapshot = structuredClone(original);
    expect(formatChordSymbolText(original)).toBe(textOverride);
    expect(original).toEqual(snapshot);
  });

  it.each([" cΔ7/e ", "", "C7(b9)", "H7"])("prefers raw text %j over structured fields", (rawText) => {
    expect(
      formatChordSymbolText({
        position: position(),
        root: { step: "D" },
        bass: { step: "F", alter: 1 },
        quality: "minor",
        rawText,
      }),
    ).toBe(rawText);
  });

  const generated: { fields: Partial<ChordSymbol>; expected: string }[] = [
    { fields: {}, expected: "C" },
    { fields: { quality: "major" }, expected: "C" },
    { fields: { quality: "major", extension: 6 }, expected: "C6" },
    { fields: { quality: "major", extension: 7 }, expected: "Cmaj7" },
    { fields: { quality: "major", extension: 9 }, expected: "Cmaj9" },
    { fields: { quality: "major", extension: 11 }, expected: "Cmaj11" },
    { fields: { quality: "major", extension: 13 }, expected: "Cmaj13" },
    { fields: { quality: "minor" }, expected: "Cm" },
    { fields: { quality: "minor", extension: 6 }, expected: "Cm6" },
    { fields: { quality: "minor", extension: 9 }, expected: "Cm9" },
    { fields: { quality: "dominant" }, expected: "C7" },
    { fields: { quality: "dominant", extension: 13 }, expected: "C13" },
    { fields: { quality: "diminished" }, expected: "Cdim" },
    { fields: { quality: "diminished", extension: 7 }, expected: "Cdim7" },
    { fields: { quality: "half-diminished" }, expected: "Cø7" },
    { fields: { quality: "half-diminished", extension: 9 }, expected: "Cø9" },
    { fields: { quality: "augmented" }, expected: "Caug" },
    { fields: { quality: "augmented", extension: 7 }, expected: "Caug7" },
    { fields: { quality: "minor-major" }, expected: "CmMaj7" },
    { fields: { quality: "minor-major", extension: 9 }, expected: "CmMaj9" },
    { fields: { quality: "suspended2" }, expected: "Csus2" },
    { fields: { quality: "suspended2", extension: 7 }, expected: "C7sus2" },
    { fields: { quality: "suspended4" }, expected: "Csus4" },
    { fields: { quality: "suspended4", extension: 11 }, expected: "C11sus4" },
    { fields: { quality: "power" }, expected: "C5" },
    { fields: { quality: "other", kindText: "7(b9)" }, expected: "C7(b9)" },
    { fields: { quality: "other" }, expected: "C?" },
    { fields: { quality: "other", kindText: "" }, expected: "C" },
    { fields: { root: { step: "F", alter: 1 }, bass: { step: "A", alter: -1 } }, expected: "F#/Ab" },
    { fields: { root: { step: "B", alter: -2 }, bass: { step: "D", alter: 2 } }, expected: "Bbb/D##" },
    { fields: { root: { step: "C", alter: 0 }, bass: { step: "E", alter: 0 } }, expected: "C/E" },
  ];
  it.each(generated)("generates $expected from structured fields", ({ fields, expected }) => {
    expect(formatChordSymbolText(freeze({ position: position(), root: { step: "C" }, ...fields }))).toBe(expected);
  });

  it("does not invent a root when only a bass or quality is present", () => {
    expect(formatChordSymbolText({ position: position() })).toBe("");
    expect(formatChordSymbolText({ position: position(), bass: { step: "E" }, quality: "minor" })).toBe("");
  });
});

describe("compareChordSymbolPositions", () => {
  it.each([
    [position(1, 4), position(2, 8)],
    [position(0, 1), position(0, MAX)],
    [position(MAX, MAX), position(1, 1)],
    [position(2, 8, 0), position(1, 4, 0)],
  ])("recognizes exact equivalent fractions %j and %j", (left, right) => {
    expect(compareChordSymbolPositions(freeze(left), freeze(right))).toBe(0);
    expect(compareChordSymbolPositions(right, left)).toBe(0);
  });

  it.each([
    [position(0, 1), position(1, MAX)],
    [position(1, 3), position(1, 2)],
    [position(3, 4), position(5, 4)],
    [position(MAX - 1, 1), position(MAX, 1)],
    [position(1, 4, 0), position(2, 8, 1)],
    [position(1, 4, MAX - 1), position(2, 8, MAX)],
    [position(1, 4, MAX), position(2, 8)],
    [position(1, 8), position(1, 4, 0)],
  ])("orders %j before %j and reverses the sign", (left, right) => {
    expect(compareChordSymbolPositions(freeze(left), freeze(right))).toBeLessThan(0);
    expect(compareChordSymbolPositions(right, left)).toBeGreaterThan(0);
  });

  it("distinguishes adjacent huge fractions despite equal JavaScript quotients", () => {
    const left = freeze(position(MAX - 2, MAX - 1));
    const right = freeze(position(MAX - 1, MAX));
    expect((MAX - 2) / (MAX - 1)).toBe((MAX - 1) / MAX);
    // Cross-products differ by exactly one, far beyond Number's exact range.
    expect(BigInt(MAX - 1) ** 2n - BigInt(MAX - 2) * BigInt(MAX)).toBe(1n);
    expect(compareChordSymbolPositions(left, right)).toBeLessThan(0);
    expect(compareChordSymbolPositions(right, left)).toBeGreaterThan(0);
  });

  it.each(INVALID_POSITIONS)("rejects $name in either argument, including self-comparison", ({ onset }) => {
    const valid = freeze(position());
    freeze(onset);
    expect(() => compareChordSymbolPositions(onset, valid)).toThrow(RangeError);
    expect(() => compareChordSymbolPositions(valid, onset)).toThrow(RangeError);
    expect(() => compareChordSymbolPositions(onset, onset)).toThrow(RangeError);
  });
});

describe("upsertGlobalChordSymbol", () => {
  it("immutably sorts and replaces every equivalent onset while retaining grace notes and metadata", () => {
    const early = chord("C", position());
    const late = chord("G", position(3, 4));
    const grace0 = chord("Dm", position(1, 4, 0));
    const grace1 = chord("Em", position(2, 8, 1));
    const measure: GlobalMeasure = freeze({
      id: "measure-12",
      number: 12,
      repeatStart: { times: 2 },
      repeatEnd: { times: 3 },
      segno: { location: position(), color: "#345678" },
      chordSymbols: [late, chord("F", position(1, 4)), grace1, early, chord("A", position(2, 8)), grace0],
    });
    const incoming = freeze({ ...chord("Bb7/D", position(3, 12)), textOverride: "Bb7/D" });
    const before = structuredClone({ measure, incoming });
    const result = upsertGlobalChordSymbol(measure, incoming);
    expect(result).toEqual({ ...measure, chordSymbols: [early, grace0, grace1, incoming, late] });
    expect(result).not.toBe(measure);
    expect(result.chordSymbols).not.toBe(measure.chordSymbols);
    expect({ measure, incoming }).toEqual(before);
  });

  it("replaces only the matching grace index, not other grace notes or the main onset", () => {
    const grace0 = chord("C", position(1, 4, 0));
    const main = chord("G", position(1, 4));
    const measure = freeze({
      chordSymbols: [main, chord("D", position(2, 8, 1)), grace0, chord("E", position(3, 12, 1))],
    });
    const incoming = freeze(chord("F", position(1, 4, 1)));
    expect(upsertGlobalChordSymbol(measure, incoming)).toEqual({
      chordSymbols: [grace0, incoming, main],
    });
  });

  it.each([{}, { chordSymbols: [] }])("accepts zero numerator and creates harmony in %j", (measure) => {
    const incoming = freeze(chord("NC", position(0, MAX)));
    expect(upsertGlobalChordSymbol(freeze(measure), incoming)).toEqual({ chordSymbols: [incoming] });
  });

  it("keeps distinct onsets that would collide as floating-point beat keys", () => {
    const early = freeze(chord("C", position(MAX - 2, MAX - 1)));
    const late = freeze(chord("G", position(MAX - 1, MAX)));
    expect(upsertGlobalChordSymbol(freeze({ chordSymbols: [late] }), early).chordSymbols).toEqual([early, late]);
  });

  it.each(INVALID_POSITIONS)("rejects incoming $name even in an empty measure", ({ onset }) => {
    expect(() => upsertGlobalChordSymbol(freeze({}), freeze(chord("C", onset)))).toThrow(RangeError);
  });
});

describe("mergeGlobalChordSymbols", () => {
  it.each([
    [8, 2, 5],
    [2, 5, 8],
    [5, 8, 2],
    [8, 5, 2],
    [5, 2, 8],
    [2, 8, 5],
  ])("keeps the smallest source index independent of source order %j, %j, %j", (...order) => {
    const winner = chord("C", position(1, 4));
    const middle = chord("Dm", position(2, 8));
    const bottom = chord("E", position(3, 12));
    const byPart = new Map<number, ChordSymbol>([
      [2, winner],
      [5, middle],
      [8, bottom],
    ]);
    const sources: ChordSymbolSource[] = freeze(
      order.map((partIndex) => ({
        partIndex,
        chordSymbols: [byPart.get(partIndex)!],
      })),
    );
    const before = structuredClone(sources);
    expect(mergeGlobalChordSymbols(freeze({}), sources)).toEqual({
      measure: { chordSymbols: [winner] },
      warnings: [conflict(middle.position, 2, 5), conflict(bottom.position, 2, 8)],
    });
    expect(sources).toEqual(before);
  });

  it("keeps the first same-source symbol across both a symbol list and repeated source entries", () => {
    const first = chord("C", position(1, 4));
    const duplicate = chord("C", position(2, 8));
    const second = chord("G", position(3, 12));
    const third = chord("Dm", position(4, 16));
    const sources = freeze([
      { partIndex: 4, chordSymbols: [first, duplicate, second] },
      { partIndex: 4, chordSymbols: [third] },
    ]);
    expect(mergeGlobalChordSymbols(freeze({}), sources)).toEqual({
      measure: { chordSymbols: [first] },
      warnings: [conflict(second.position, 4, 4), conflict(third.position, 4, 4)],
    });
  });

  it.each([
    ["C#maj7/G#", "DbM7/Ab"],
    ["C##", "D"],
    ["Bbb", "A"],
    ["Cm7", "C-7"],
    ["Cdim7", "Co7"],
    ["Caug", "C+"],
    ["Cø7", "Cm7b5"],
    ["CmMaj7", "C-Δ7"],
    ["Csus4", "Csus"],
    ["C", "C/C"],
    ["NC", " N.C. "],
    ["n.c", "nc"],
  ])("coalesces musically equivalent %s and %s without warnings", (left, right) => {
    const winner = freeze(chord(left, position(1, 4)));
    const other = freeze(chord(right, position(2, 8)));
    const expectedStatus = /^n/i.test(left) ? "silent" : "supported";
    expect(resolveChordSymbol(winner).status).toBe(expectedStatus);
    expect(resolveChordSymbol(other).status).toBe(expectedStatus);
    expect(
      mergeGlobalChordSymbols(
        freeze({}),
        freeze([
          { partIndex: 7, chordSymbols: [other] },
          { partIndex: 1, chordSymbols: [winner] },
        ]),
      ),
    ).toEqual({ measure: { chordSymbols: [winner] }, warnings: [] });
  });

  it("coalesces structured and raw-only equivalents, retaining the winning authored spelling", () => {
    const winner: ChordSymbol = freeze({
      position: position(),
      root: { step: "C", alter: 1 },
      bass: { step: "G", alter: 1 },
      quality: "major",
      extension: 7,
      textOverride: "DbM7/Ab",
    });
    const rawOnly: ChordSymbol = freeze({ position: position(0, 8), rawText: "C#Δ7/G#" });
    expect(
      mergeGlobalChordSymbols(
        {},
        freeze([
          { partIndex: 0, chordSymbols: [winner] },
          { partIndex: 1, chordSymbols: [rawOnly] },
        ]),
      ),
    ).toEqual({ measure: { chordSymbols: [winner] }, warnings: [] });
  });

  it.each([
    ["C", "Cm"],
    ["C", "C7"],
    ["C/E", "C/G"],
    ["C", "C/D"],
    // Symmetric augmented triads share tones, but their roots are not interchangeable.
    ["Caug/C", "Eaug/C"],
    ["Cdim7/C", "Ebdim7/C"],
    ["NC", "C"],
    ["Cadd9", "C"],
    ["Cadd9", "Cadd11"],
    ["H7", "H9"],
  ])("warns for distinct harmony %s versus %s", (left, right) => {
    const winner = freeze(chord(left, position(1, 4)));
    const discarded = freeze(chord(right, position(2, 8)));
    expect(
      mergeGlobalChordSymbols(
        {},
        freeze([
          { partIndex: 3, chordSymbols: [discarded] },
          { partIndex: 0, chordSymbols: [winner] },
        ]),
      ),
    ).toEqual({
      measure: { chordSymbols: [winner] },
      warnings: [conflict(discarded.position, 0, 3)],
    });
  });

  it.each(["Cadd9", "H7", ""])("coalesces equal unsupported display text %j without legitimizing it", (text) => {
    const winner = freeze(chord(text));
    const other = freeze(chord(text, position(0, 4)));
    expect(resolveChordSymbol(winner).status).toBe("unsupported");
    expect(
      mergeGlobalChordSymbols(
        {},
        freeze([
          { partIndex: 0, chordSymbols: [winner] },
          { partIndex: 2, chordSymbols: [other] },
        ]),
      ),
    ).toEqual({ measure: { chordSymbols: [winner] }, warnings: [] });
  });

  it("replaces existing global onsets without considering them competing sources", () => {
    const early = chord("F", position());
    const late = chord("G", position(3, 4));
    const measure: GlobalMeasure = freeze({
      id: "global",
      number: 9,
      repeatEnd: { times: 2 },
      fine: { location: position(1, 1), color: "#123456" },
      chordSymbols: [late, chord("A", position(1, 4)), early, chord("B", position(2, 8))],
    });
    const winner = chord("C", position(3, 12));
    const discarded = chord("D", position(4, 16));
    const sources = freeze([
      { partIndex: 8, chordSymbols: [discarded] },
      { partIndex: 6, chordSymbols: [winner] },
    ]);
    const before = structuredClone({ measure, sources });
    const result = mergeGlobalChordSymbols(measure, sources);
    expect(result).toEqual({
      measure: { ...measure, chordSymbols: [early, winner, late] },
      warnings: [conflict(discarded.position, 6, 8)],
    });
    expect(result.measure).not.toBe(measure);
    expect(result.measure.chordSymbols).not.toBe(measure.chordSymbols);
    expect({ measure, sources }).toEqual(before);
  });

  it("replaces a conflicting global symbol with a sole incoming selection without warning", () => {
    const measure = freeze({ chordSymbols: [chord("C")] });
    const incoming = freeze(chord("G"));
    expect(mergeGlobalChordSymbols(measure, freeze([{ partIndex: 10, chordSymbols: [incoming] }]))).toEqual({
      measure: { chordSymbols: [incoming] },
      warnings: [],
    });
  });

  it.each<{ sources: ChordSymbolSource[] }>([{ sources: [] }, { sources: [{ partIndex: 0, chordSymbols: [] }] }])(
    "leaves global harmony untouched with no incoming symbols $sources",
    ({ sources }) => {
      const measure = freeze({
        id: "unchanged",
        chordSymbols: [chord("G", position(3, 4)), chord("C"), chord("D", position(0, 8))],
      });
      expect(mergeGlobalChordSymbols(measure, freeze(sources))).toEqual({ measure, warnings: [] });
      expect(mergeGlobalChordSymbols(freeze({ id: "empty" }), sources)).toEqual({
        measure: { id: "empty" },
        warnings: [],
      });
    },
  );

  it("sorts distinct incoming onsets and retains grace/main distinctions across sources", () => {
    const grace0 = chord("Dm", position(1, 4, 0));
    const grace1 = chord("Em", position(2, 8, 1));
    const main = chord("F", position(1, 4));
    const early = chord("C", position());
    const late = chord("G", position(3, 4));
    const discardedGrace = chord("A", position(3, 12, 1));
    const measure = freeze({ chordSymbols: [chord("B", position(4, 16, 1))] });
    const sources = freeze([
      { partIndex: 9, chordSymbols: [main, discardedGrace, early] },
      { partIndex: 2, chordSymbols: [late, grace1, grace0] },
    ]);
    const before = structuredClone({ measure, sources });
    expect(mergeGlobalChordSymbols(measure, sources)).toEqual({
      measure: { chordSymbols: [early, grace0, grace1, main, late] },
      warnings: [conflict(discardedGrace.position, 2, 9)],
    });
    expect({ measure, sources }).toEqual(before);
  });

  it("does not merge distinct incoming fractions that round to the same Number", () => {
    const early = chord("C", position(MAX - 2, MAX - 1));
    const late = chord("D", position(MAX - 1, MAX));
    expect(
      mergeGlobalChordSymbols(
        {},
        freeze([
          { partIndex: 0, chordSymbols: [late] },
          { partIndex: 1, chordSymbols: [early] },
        ]),
      ),
    ).toEqual({ measure: { chordSymbols: [early, late] }, warnings: [] });
  });

  it.each(INVALID_POSITIONS)("rejects incoming $name even as a singleton", ({ onset }) => {
    const sources = freeze([{ partIndex: 0, chordSymbols: [chord("C", onset)] }]);
    expect(() => mergeGlobalChordSymbols(freeze({}), sources)).toThrow(RangeError);
  });

  it("validates a discarded lower source rather than silently ignoring its invalid onset", () => {
    const measure = freeze({ id: "original", chordSymbols: [chord("F")] });
    const sources = freeze([
      { partIndex: 0, chordSymbols: [chord("C")] },
      { partIndex: 1, chordSymbols: [chord("G", position(0, 0))] },
    ]);
    const before = structuredClone({ measure, sources });
    expect(() => mergeGlobalChordSymbols(measure, sources)).toThrow(RangeError);
    expect({ measure, sources }).toEqual(before);
  });
});

import { describe, expect, it } from "vitest";
import {
  CHORDS_PART_ID,
  UNSUPPORTED_CHORD_MESSAGE,
  parseChordSymbolText,
  resolveChordSymbol,
  voiceChordSymbol,
  type ChordQuality,
  type ChordRoot,
  type ChordSymbol,
  type RhythmicPosition,
} from "../index";

const POSITION: RhythmicPosition = { fraction: [1, 4], graceIndex: 2 };
const UNSUPPORTED = {
  status: "unsupported",
  message: "Unsupported chord: cannot play this symbol.",
};
const EMPTY_VOICING = { leftHand: [], rightHand: [] };

function structured(fields: Partial<ChordSymbol> = {}): ChordSymbol {
  return { position: POSITION, root: { step: "C" }, ...fields };
}

function parsed(text: string): ChordSymbol {
  return parseChordSymbolText(text, POSITION);
}

describe("parseChordSymbolText lossless entry", () => {
  it.each(["", " ", "\t\n", "H7", "C/E/G", "/C", "♯C", "?", "N.C.", " NC "])(
    "preserves rootless input %j and its complete position",
    (text) => {
      const before = structuredClone(POSITION);
      expect(parsed(text)).toEqual({ position: POSITION, rawText: text });
      expect(POSITION).toEqual(before);
    },
  );

  it.each([
    ["c", { step: "C" }],
    ["C#", { step: "C", alter: 1 }],
    ["d♭", { step: "D", alter: -1 }],
    ["F♯", { step: "F", alter: 1 }],
    ["G##", { step: "G", alter: 2 }],
    ["Abb", { step: "A", alter: -2 }],
    ["Bx", { step: "B", alter: 2 }],
    ["C𝄪", { step: "C", alter: 2 }],
    ["D𝄫", { step: "D", alter: -2 }],
    ["E♭♭", { step: "E", alter: -2 }],
    ["F♯♯", { step: "F", alter: 2 }],
  ] satisfies [string, ChordRoot][])("parses accidental spelling %s", (text, root) => {
    expect(parsed(text)).toEqual({ position: POSITION, rawText: text, root, quality: "major" });
  });

  it("preserves whitespace, case, Unicode and slash-bass spelling verbatim", () => {
    const text = "\t f♯mMaj9/b𝄫  ";
    expect(parsed(text)).toEqual({
      position: POSITION,
      rawText: text,
      root: { step: "F", alter: 1 },
      quality: "minor-major",
      extension: 9,
      bass: { step: "B", alter: -2 },
    });
  });

  it.each([
    ["C7b9", "7b9"],
    ["Cmaj7#11", "maj7#11"],
    ["C6/9", undefined],
    ["Cgarbage", "garbage"],
    ["C14", "14"],
  ])("retains unsupported syntax %s without major fallback", (text, kindText) => {
    const chord = parsed(text);
    expect(chord.rawText).toBe(text);
    if (kindText !== undefined) {
      expect(chord).toMatchObject({ root: { step: "C" }, quality: "other", kindText });
    } else {
      expect(chord.root).toBeUndefined();
    }
    expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
    expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
  });
});

interface QualityCase {
  quality: Exclude<ChordQuality, "other">;
  tones: readonly (readonly number[] | undefined)[];
}

// Columns are no extension, sixth, seventh, ninth, eleventh and thirteenth.
// Literal pitch sets keep these expectations independent of the resolver algorithm.
const QUALITY_CASES: QualityCase[] = [
  {
    quality: "major",
    tones: [
      [0, 4, 7],
      [0, 4, 7, 9],
      [0, 4, 7, 11],
      [0, 2, 4, 7, 11],
      [0, 2, 4, 5, 7, 11],
      [0, 2, 4, 5, 7, 9, 11],
    ],
  },
  {
    quality: "minor",
    tones: [
      [0, 3, 7],
      [0, 3, 7, 9],
      [0, 3, 7, 10],
      [0, 2, 3, 7, 10],
      [0, 2, 3, 5, 7, 10],
      [0, 2, 3, 5, 7, 9, 10],
    ],
  },
  {
    quality: "dominant",
    tones: [
      [0, 4, 7, 10],
      [0, 4, 7, 9],
      [0, 4, 7, 10],
      [0, 2, 4, 7, 10],
      [0, 2, 4, 5, 7, 10],
      [0, 2, 4, 5, 7, 9, 10],
    ],
  },
  {
    quality: "diminished",
    tones: [
      [0, 3, 6],
      [0, 3, 6, 9],
      [0, 3, 6, 9],
      [0, 2, 3, 6, 9],
      [0, 2, 3, 5, 6, 9],
      [0, 2, 3, 5, 6, 9],
    ],
  },
  {
    quality: "half-diminished",
    tones: [
      [0, 3, 6, 10],
      [0, 3, 6, 9],
      [0, 3, 6, 10],
      [0, 2, 3, 6, 10],
      [0, 2, 3, 5, 6, 10],
      [0, 2, 3, 5, 6, 9, 10],
    ],
  },
  {
    quality: "augmented",
    tones: [
      [0, 4, 8],
      [0, 4, 8, 9],
      [0, 4, 8, 10],
      [0, 2, 4, 8, 10],
      [0, 2, 4, 5, 8, 10],
      [0, 2, 4, 5, 8, 9, 10],
    ],
  },
  {
    quality: "minor-major",
    tones: [
      [0, 3, 7, 11],
      [0, 3, 7, 9],
      [0, 3, 7, 11],
      [0, 2, 3, 7, 11],
      [0, 2, 3, 5, 7, 11],
      [0, 2, 3, 5, 7, 9, 11],
    ],
  },
  {
    quality: "suspended2",
    tones: [
      [0, 2, 7],
      [0, 2, 7, 9],
      [0, 2, 7, 10],
      [0, 2, 7, 10],
      [0, 2, 5, 7, 10],
      [0, 2, 5, 7, 9, 10],
    ],
  },
  {
    quality: "suspended4",
    tones: [
      [0, 5, 7],
      [0, 5, 7, 9],
      [0, 5, 7, 10],
      [0, 2, 5, 7, 10],
      [0, 2, 5, 7, 10],
      [0, 2, 5, 7, 9, 10],
    ],
  },
  { quality: "power", tones: [[0, 7], undefined, undefined, undefined, undefined, undefined] },
];
const EXTENSIONS: ChordSymbol["extension"][] = [undefined, 6, 7, 9, 11, 13];

describe.each(QUALITY_CASES)("structured $quality quality/extension matrix", ({ quality, tones }) => {
  describe.each([
    { root: { step: "C" }, pc: 0 },
    { root: { step: "F", alter: 1 }, pc: 6 },
  ])("root $root", ({ root, pc }) => {
    it.each(EXTENSIONS.map((extension, index) => ({ extension, expected: tones[index] })))(
      "resolves and voices extension $extension without omitted or duplicate tones",
      ({ extension, expected }) => {
        const chord = structured({ root, quality, ...(extension === undefined ? {} : { extension }) });
        if (expected === undefined) {
          expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
          expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
          return;
        }
        const pitchClasses = expected.map((tone) => (tone + pc) % 12).sort((a, b) => a - b);
        expect(resolveChordSymbol(chord)).toEqual({
          status: "supported",
          rootPitchClass: pc,
          bassPitchClass: pc,
          pitchClasses,
        });
        expect(voiceChordSymbol(chord)).toEqual({
          leftHand: [36 + pc],
          rightHand: pitchClasses.map((tone) => 60 + tone),
        });
      },
    );
  });
});

describe("parsed musical aliases", () => {
  it.each([
    { texts: ["C", "Cmaj", "CM", "Cma"], quality: "major", extension: undefined, tones: [0, 4, 7] },
    { texts: ["Cm", "Cmin", "C-"], quality: "minor", extension: undefined, tones: [0, 3, 7] },
    { texts: ["Cdim", "Co", "C°"], quality: "diminished", extension: undefined, tones: [0, 3, 6] },
    { texts: ["Caug", "C+"], quality: "augmented", extension: undefined, tones: [0, 4, 8] },
    { texts: ["Csus", "Csus4"], quality: "suspended4", extension: undefined, tones: [0, 5, 7] },
    { texts: ["Csus2"], quality: "suspended2", extension: undefined, tones: [0, 2, 7] },
    { texts: ["C5"], quality: "power", extension: undefined, tones: [0, 7] },
    { texts: ["C0", "Cø", "Cø7", "Cm7b5"], quality: "half-diminished", extension: 7, tones: [0, 3, 6, 10] },
    { texts: ["CmMaj", "CminM", "C-Δ", "CmMaj7"], quality: "minor-major", extension: 7, tones: [0, 3, 7, 11] },
    { texts: ["CM7", "Cmaj7", "CΔ7", "C△7", "CΔ", "C△"], quality: "major", extension: 7, tones: [0, 4, 7, 11] },
    { texts: ["C7"], quality: "dominant", extension: 7, tones: [0, 4, 7, 10] },
    { texts: ["C9"], quality: "dominant", extension: 9, tones: [0, 2, 4, 7, 10] },
    { texts: ["Cmaj9", "CM9"], quality: "major", extension: 9, tones: [0, 2, 4, 7, 11] },
    { texts: ["C6", "Cadd6"], quality: "major", extension: 6, tones: [0, 4, 7, 9] },
    { texts: ["Cm6", "Cmin6"], quality: "minor", extension: 6, tones: [0, 3, 7, 9] },
    { texts: ["C9sus2"], quality: "suspended2", extension: 9, tones: [0, 2, 7, 10] },
    { texts: ["C7sus", "C7sus4", "Csus47"], quality: "suspended4", extension: 7, tones: [0, 5, 7, 10] },
    { texts: ["Cdim13"], quality: "diminished", extension: 13, tones: [0, 2, 3, 5, 6, 9] },
    { texts: ["Cø11"], quality: "half-diminished", extension: 11, tones: [0, 2, 3, 5, 6, 10] },
    { texts: ["CmMaj13"], quality: "minor-major", extension: 13, tones: [0, 2, 3, 5, 7, 9, 11] },
  ])("resolves $texts as $quality with extension $extension", ({ texts, quality, extension, tones }) => {
    for (const text of texts) {
      const chord = parsed(text);
      expect(chord.quality, text).toBe(quality);
      expect(chord.extension, text).toBe(extension);
      expect(resolveChordSymbol(chord), text).toEqual({
        status: "supported",
        rootPitchClass: 0,
        bassPitchClass: 0,
        pitchClasses: tones,
      });
    }
  });

  it("intentionally defaults a structured root-only symbol to major", () => {
    expect(resolveChordSymbol(structured())).toEqual({
      status: "supported",
      rootPitchClass: 0,
      bassPitchClass: 0,
      pitchClasses: [0, 4, 7],
    });
  });

  it.each([
    ["C", 0, [0, 4, 7]],
    ["D", 2, [2, 6, 9]],
    ["E", 4, [4, 8, 11]],
    ["F", 5, [0, 5, 9]],
    ["G", 7, [2, 7, 11]],
    ["A", 9, [1, 4, 9]],
    ["B", 11, [3, 6, 11]],
    ["B#", 0, [0, 4, 7]],
    ["Cb", 11, [3, 6, 11]],
    ["Dbb", 0, [0, 4, 7]],
    ["B𝄪", 1, [1, 5, 8]],
    ["F𝄫", 3, [3, 7, 10]],
    ["G♯", 8, [0, 3, 8]],
  ] satisfies [string, number, number[]][])("wraps %s to pitch classes", (text, pc, pitchClasses) => {
    expect(resolveChordSymbol(parsed(text))).toEqual({
      status: "supported",
      rootPitchClass: pc,
      bassPitchClass: pc,
      pitchClasses,
    });
  });

  it.each([
    ["C", Number.MAX_SAFE_INTEGER, 7, [2, 7, 11]],
    ["C", -Number.MAX_SAFE_INTEGER, 5, [0, 5, 9]],
    ["B", Number.MAX_SAFE_INTEGER, 6, [1, 6, 10]],
    ["B", -Number.MAX_SAFE_INTEGER, 4, [4, 8, 11]],
    ["C", 24, 0, [0, 4, 7]],
    ["C", -24, 0, [0, 4, 7]],
  ] satisfies [string, number, number, number[]][])(
    "normalizes %s with safe alteration %s",
    (step, alter, pc, pitchClasses) => {
      expect(resolveChordSymbol(structured({ root: { step, alter } }))).toEqual({
        status: "supported",
        rootPitchClass: pc,
        bassPitchClass: pc,
        pitchClasses,
      });
    },
  );
});

describe("resolution refuses contradictory display and structured harmony", () => {
  it.each([
    { rawText: "Cm" },
    { rawText: "D" },
    { rawText: "C/E" },
    { rawText: "Cadd9" },
    { rawText: "" },
    { rawText: "N.C." },
    { textOverride: "Cm" },
    { textOverride: "D" },
    { textOverride: "C/F#" },
    { textOverride: "C7" },
    { textOverride: "Cadd9" },
    { textOverride: "H7" },
    { textOverride: "not a chord" },
    { textOverride: "" },
    { textOverride: "NC" },
    { kindText: "m" },
    { kindText: "7" },
    { kindText: "madd9" },
    { kindText: "unrecognized" },
    { rawText: "Cm", textOverride: "C" },
    { rawText: "C", textOverride: "Cm" },
    { rawText: "C", kindText: "m" },
    { rawText: "C", kindText: "maj", textOverride: "H7" },
  ] satisfies Partial<ChordSymbol>[])("rejects contradictory fields %j", (fields) => {
    const chord = structured(fields);
    expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
    expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
  });

  it.each([
    { rawText: "c", textOverride: "Cmaj", kindText: "M" },
    { rawText: "B#", textOverride: "Dbb", kindText: "" },
    { rawText: "C", textOverride: "C/C", kindText: "maj" },
  ] satisfies Partial<ChordSymbol>[])("accepts equivalent spellings %j", (fields) => {
    expect(resolveChordSymbol(structured(fields))).toEqual({
      status: "supported",
      rootPitchClass: 0,
      bassPitchClass: 0,
      pitchClasses: [0, 4, 7],
    });
  });

  it("accepts equivalent quality, extension and enharmonic slash-bass spellings together", () => {
    const chord = structured({
      quality: "half-diminished",
      bass: { step: "F", alter: 1 },
      rawText: "Cm7b5/F#",
      textOverride: "B#ø/Gb",
      kindText: "ø7",
    });
    expect(resolveChordSymbol(chord)).toEqual({
      status: "supported",
      rootPitchClass: 0,
      bassPitchClass: 6,
      pitchClasses: [0, 3, 6, 10],
    });
  });

  it.each(["rawText", "textOverride", "kindText"] as const)(
    "distinguishes dominant ninth from major ninth in %s",
    (field) => {
      const chord = structured({ quality: "dominant", extension: 9, [field]: field === "kindText" ? "maj9" : "Cmaj9" });
      expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
    },
  );
});

describe("silent, rootless and invalid symbols", () => {
  it.each(["NC", "N.C.", "N.C", "nc", "n.c.", " \tN.C.\n"])("treats %j as silent", (text) => {
    const chord = parsed(text);
    expect(resolveChordSymbol(chord)).toEqual({ status: "silent" });
    expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
  });

  it("allows equivalent no-chord display spellings", () => {
    expect(resolveChordSymbol({ ...parsed(" NC "), textOverride: "n.c." })).toEqual({ status: "silent" });
  });

  it.each([
    { root: { step: "C" } },
    { bass: { step: "C" } },
    { quality: "major" },
    { extension: 7 },
    { kindText: "" },
    { textOverride: "C" },
    { textOverride: "unparseable" },
  ] satisfies Partial<ChordSymbol>[])("rejects NC with contradictory metadata %j", (fields) => {
    const chord: ChordSymbol = { position: POSITION, rawText: "NC", ...fields };
    expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
    expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
  });

  it("resolves rootless raw harmony without fabricating structured fields", () => {
    const chord: ChordSymbol = { position: POSITION, rawText: "Dbmaj9/Ab", textOverride: "C#M9/G#" };
    const before = structuredClone(chord);
    expect(resolveChordSymbol(chord)).toEqual({
      status: "supported",
      rootPitchClass: 1,
      bassPitchClass: 8,
      pitchClasses: [0, 1, 3, 5, 8],
    });
    expect(chord).toEqual(before);
    expect(chord.root).toBeUndefined();
  });

  it.each([
    { position: POSITION },
    { position: POSITION, textOverride: "C" },
    { position: POSITION, rawText: "" },
    { position: POSITION, rawText: "H7" },
    { position: POSITION, rawText: "C/E/G" },
    { position: POSITION, rawText: "C", quality: "major" },
    { position: POSITION, rawText: "C", bass: { step: "C" } },
    { position: POSITION, rawText: "C", extension: 7 },
    { position: POSITION, rawText: "C", kindText: "maj" },
    structured({ quality: "other" }),
    structured({ quality: "other", kindText: "maj", rawText: "C", textOverride: "C" }),
  ] satisfies ChordSymbol[])("never guesses harmony for invalid symbol %j", (chord) => {
    expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
    expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
  });

  it.each(["unknown", "", "constructor", "__proto__", "toString"])("safely rejects unknown quality %j", (quality) => {
    const chord = structured({ quality: quality as ChordQuality });
    expect(resolveChordSymbol(chord)).toEqual(UNSUPPORTED);
    expect(voiceChordSymbol(chord)).toEqual(EMPTY_VOICING);
  });

  it.each([0, 5, 8, 14, 7.5, NaN, Infinity])("rejects invalid extension %s", (extension) => {
    expect(resolveChordSymbol(structured({ extension: extension as ChordSymbol["extension"] }))).toEqual(UNSUPPORTED);
  });

  describe.each(["root", "bass"] as const)("invalid %s", (field) => {
    it.each(["H", "c", "", "CC", "constructor", "__proto__", "toString"])("rejects step %j", (step) => {
      expect(resolveChordSymbol(structured({ [field]: { step } }))).toEqual(UNSUPPORTED);
    });

    it.each([0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
      "rejects alteration %s",
      (alter) => {
        expect(resolveChordSymbol(structured({ [field]: { step: "C", alter } }))).toEqual(UNSUPPORTED);
      },
    );
  });
});

describe("deterministic chord playback", () => {
  it("exports the reserved derived channel ID and exact unsupported diagnostic", () => {
    expect(CHORDS_PART_ID).toBe("viritura:derived:chords");
    expect(UNSUPPORTED_CHORD_MESSAGE).toBe(UNSUPPORTED.message);
  });

  it.each([
    ["C/E", 0, 4, [0, 4, 7], [40], [60, 64, 67]],
    ["C/F#", 0, 6, [0, 4, 7], [42], [60, 64, 67]],
    ["B/F", 11, 5, [3, 6, 11], [41], [63, 66, 71]],
    ["Bb13/E", 10, 4, [0, 2, 3, 5, 7, 8, 10], [40], [60, 62, 63, 65, 67, 68, 70]],
    ["C5/B", 0, 11, [0, 7], [47], [60, 67]],
    ["C/B#", 0, 0, [0, 4, 7], [36], [60, 64, 67]],
  ] satisfies [string, number, number, number[], number[], number[]][])(
    "voices %s with root retained and nonchord slash bass excluded from the right hand",
    (text, rootPitchClass, bassPitchClass, pitchClasses, leftHand, rightHand) => {
      const chord = parsed(text);
      expect(resolveChordSymbol(chord)).toEqual({ status: "supported", rootPitchClass, bassPitchClass, pitchClasses });
      expect(voiceChordSymbol(chord)).toEqual({ leftHand, rightHand });
    },
  );

  it("does not mutate frozen input or reuse mutable result arrays", () => {
    const chord = parsed("F#13/C");
    Object.freeze(chord.position.fraction);
    Object.freeze(chord.position);
    Object.freeze(chord.root);
    Object.freeze(chord.bass);
    Object.freeze(chord);
    const before = structuredClone(chord);
    const resolution = resolveChordSymbol(chord);
    const voicing = voiceChordSymbol(chord);
    const expectedResolution = structuredClone(resolution);
    const expectedVoicing = structuredClone(voicing);
    expect(resolution.status).toBe("supported");
    if (resolution.status === "supported") resolution.pitchClasses.push(99);
    voicing.leftHand.push(99);
    voicing.rightHand.push(99);
    expect(resolveChordSymbol(chord)).toEqual(expectedResolution);
    expect(voiceChordSymbol(chord)).toEqual(expectedVoicing);
    expect(chord).toEqual(before);
  });
});

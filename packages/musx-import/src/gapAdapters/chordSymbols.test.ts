import {
  formatChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  voiceChordSymbol,
  type ChordSymbol,
} from "@viritura/core";
import { describe, expect, it } from "vitest";
import type { DenigmaGapReport } from "../types";
import { applyDenigmaGapReport } from "./applyGapReport";
import type { JsonRecord, KnownChordGap } from "./types";

interface RawMeasure {
  _x?: { viritura?: { chordSymbols?: ChordSymbol[]; rehearsalMark?: { text: string } } };
}

interface RawPart {
  measures: RawMeasure[];
  _x?: { viritura?: { chordSymbolVisibility?: string; instrumentId?: string } };
}

interface RawDocument {
  global: { measures: RawMeasure[] };
  parts: RawPart[];
}

function document(partCount = 1): JsonRecord {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: Array.from({ length: partCount }, (_, index) => ({
      id: `P${index + 1}`,
      measures: [{ sequences: [] }],
    })),
  };
}

function chordGap(step = "C", suffixText = "maj7", quality = "major-seventh"): KnownChordGap {
  return {
    type: "chord-symbol",
    anchor: "P1.m1",
    extent: "complete",
    position: { numerator: 0, denominator: 1 },
    chord: {
      root: { step, alteration: 0 },
      rootLowerCase: false,
      showRoot: true,
      showSuffix: true,
      suffix: {
        strings: [{ text: suffixText, position: "inline" }],
        suffixText,
        quality,
        degrees: [],
        parenthesizeDegrees: false,
        stackDegrees: false,
        hasOuterParentheses: false,
        hasUnrecognizedGlyphs: false,
      },
    },
  };
}

function apply(gaps: KnownChordGap[], source = document()) {
  const report: DenigmaGapReport = {
    schemaVersion: 1,
    producer: { name: "denigma", version: "4.0.0", commit: "5864f4e" },
    gaps,
  };
  const result = applyDenigmaGapReport(JSON.stringify(source), report);
  const parsed = JSON.parse(result.mnxJson) as RawDocument;
  return { ...result, document: parsed, chords: parsed.global.measures[0]?._x?.viritura?.chordSymbols ?? [] };
}

function sourcePart(source: JsonRecord, index = 0): JsonRecord {
  return (source["parts"] as JsonRecord[])[index]!;
}

function globalMeasure(source: JsonRecord): JsonRecord {
  return ((source["global"] as JsonRecord)["measures"] as JsonRecord[])[0]!;
}

describe("global MUSX chord symbols", () => {
  describe.each([false, true])("source aliases (rich typography=%s)", (rich) => {
    it.each([
      { suffix: "M7", quality: "major-seventh", display: "Cmaj7/E" },
      { suffix: "Δ", quality: "major-seventh", display: "Cmaj7/E" },
      { suffix: "min7", quality: "minor-seventh", display: "Cm7/E" },
      { suffix: "-7", quality: "minor-seventh", display: "Cm7/E" },
      { suffix: "°7", quality: "diminished-seventh", display: "Cdim7/E" },
      { suffix: "o7", quality: "diminished-seventh", display: "Cdim7/E" },
      { suffix: "+", quality: "augmented", display: "Caug/E" },
      { suffix: "+7", quality: "augmented-seventh", display: "Caug7/E" },
      { suffix: "m7b5", quality: "half-diminished", display: "Cø7/E" },
      { suffix: "07", quality: "half-diminished", display: "Cø7/E" },
      { suffix: "mΔ", quality: "major-minor", display: "CmMaj7/E" },
      { suffix: "sus", quality: "suspended-fourth", display: "Csus4/E" },
    ])("renders $suffix in house style without losing provenance", ({ suffix, quality, display }) => {
      const gap = chordGap("C", suffix, quality);
      gap.chord.bass = { step: "E", alteration: 0 };
      if (rich) gap.chord.suffix.strings = [{ text: suffix, position: "above" }];
      const result = apply([gap]);
      const chord = result.chords[0]!;
      expect(chord).toMatchObject({ rawText: `C${suffix}/E`, kindText: suffix });
      expect(chord).not.toHaveProperty("textOverride");
      expect(resolveChordSymbol(chord).status).toBe("supported");
      expect(result.outcomes[0]?.disposition).toBe(rich ? "handled-partially" : "handled");
      expect(result.diagnostics.every((entry) => !entry.message.includes("Unsupported chord"))).toBe(true);
      expect(formatChordSymbolText(chord)).toBe(display);
    });
  });

  it("keeps concert aliases in storage when formatting transposed context copies", () => {
    const source = document();
    sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
    const gap = chordGap("D", "M7", "major-seventh");
    gap.chord.bass = { step: "F", alteration: 1 };
    gap.chord.suffix.stackDegrees = true;
    const originalGap = structuredClone(gap);
    const result = apply([gap], source);
    const stored = result.chords[0]!;
    const before = structuredClone(stored);
    const written = transposeChordSymbol(stored, { halfSteps: 2, staffDistance: 1 });
    expect(stored).toMatchObject({ root: { step: "C" }, bass: { step: "E" }, rawText: "CM7/E" });
    expect(written).toMatchObject({ root: { step: "D" }, bass: { step: "F", alter: 1 }, rawText: "DM7/F#" });
    expect(stored).not.toHaveProperty("textOverride");
    expect(written).not.toHaveProperty("textOverride");
    expect(stored).toEqual(before);
    expect(gap).toEqual(originalGap);
    expect(apply([], JSON.parse(result.mnxJson) as JsonRecord).chords).toEqual([before]);
    expect(formatChordSymbolText(stored)).toBe("Cmaj7/E");
    expect(formatChordSymbolText(written)).toBe("Dmaj7/F#");
  });

  it.each(["cM7/e", ""])("retains an existing authored override %j through import and storage", (textOverride) => {
    const source = document();
    const retained: ChordSymbol = {
      position: { fraction: [3, 4] },
      root: { step: "C" },
      bass: { step: "E" },
      quality: "major",
      extension: 7,
      rawText: "CM7/E",
      kindText: "M7",
      textOverride,
    };
    globalMeasure(source)["_x"] = { viritura: { chordSymbols: [retained] } };
    const result = apply([chordGap()], source);
    expect(result.chords[1]).toEqual(retained);
    expect(formatChordSymbolText(result.chords[1]!)).toBe(textOverride);
    expect(apply([], JSON.parse(result.mnxJson) as JsonRecord).chords).toEqual(result.chords);
    expect(result.diagnostics).toEqual([]);
  });

  it("stores only global harmony and replaces hidden source-part visibility with show", () => {
    const source = document(3);
    sourcePart(source)["_x"] = { viritura: { chordSymbolVisibility: "hide", instrumentId: "clarinet" } };
    sourcePart(source, 1)["_x"] = { viritura: { chordSymbolVisibility: "auto" } };
    sourcePart(source, 2)["_x"] = { viritura: { chordSymbolVisibility: "hide" } };
    const second = chordGap();
    second.anchor = "P2.m1";
    const original = JSON.stringify(source);
    const result = apply([second, chordGap()], source);
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]).not.toHaveProperty("displayStaff");
    expect(result.document.parts.map((part) => part._x?.viritura?.chordSymbolVisibility)).toEqual([
      "show",
      "show",
      "hide",
    ]);
    expect(result.document.parts[0]?._x?.viritura?.instrumentId).toBe("clarinet");
    for (const part of result.document.parts) {
      expect(part.measures[0]?._x?.viritura?.chordSymbols).toBeUndefined();
    }
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(source)).toBe(original);
  });

  it.each([false, true])(
    "converts written Bb-instrument roots AND slash bass to concert (preference=%s)",
    (preference) => {
      const source = document();
      sourcePart(source)["transposition"] = {
        interval: { halfSteps: 2, staffDistance: 1 },
        prefersWrittenPitches: preference,
      };
      const gap = chordGap("D");
      gap.chord.bass = { step: "F", alteration: 1 };
      const result = apply([gap], source);
      expect(result.chords[0]).toMatchObject({
        root: { step: "C" },
        bass: { step: "E" },
        rawText: "Cmaj7/E",
      });
      expect(result.chords[0]).not.toHaveProperty("textOverride");
      expect(resolveChordSymbol(result.chords[0]!)).toEqual({
        status: "supported",
        rootPitchClass: 0,
        bassPitchClass: 4,
        pitchClasses: [0, 4, 7, 11],
      });
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([..."ABCDEFGabcdefg"])("normalizes source root and bass letters: %s", (step) => {
    const gap = chordGap(step);
    gap.chord.bass = { step, alteration: 0 };
    const result = apply([gap]);
    expect(result.chords[0]).toMatchObject({
      root: { step: step.toUpperCase() },
      bass: { step: step.toUpperCase() },
      rawText: `${step.toUpperCase()}maj7/${step.toUpperCase()}`,
    });
    expect(result.diagnostics).toEqual([]);
  });

  describe.each(["root", "bass"] as const)("source %s validation", (pitch) => {
    it.each(["H", "h", "", "AB", "C#", " C", "C ", "C\n"])("rejects invalid step %j", (step) => {
      const gap = chordGap();
      gap.chord[pitch] = { step, alteration: 0 };
      expect(() => apply([gap])).toThrow("Invalid source chord pitch");
    });

    it.each([Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1])(
      "rejects unsafe alteration %s",
      (alteration) => {
        const gap = chordGap();
        gap.chord[pitch] = { step: "C", alteration };
        expect(() => apply([gap])).toThrow("Invalid source chord pitch");
      },
    );

    it.each([0.5, -0.5, NaN, Infinity, -Infinity, "1", null, undefined])(
      "leaves malformed alteration %s unhandled without emitting harmony",
      (alteration) => {
        const gap = chordGap();
        Object.assign(gap.chord, { [pitch]: { step: "C", alteration } });
        const result = apply([gap]);
        expect(result.chords).toEqual([]);
        expect(result.document.parts[0]?._x?.viritura?.chordSymbolVisibility).toBeUndefined();
        expect(result.outcomes[0]).toMatchObject({
          disposition: "unhandled",
          reason: "Malformed chord-symbol payload.",
        });
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).not.toContain("Unsupported chord");
      },
    );

    it.each([Number.MIN_SAFE_INTEGER, -129, -128, -2, -1, 0, 1, 2, 128, 129, Number.MAX_SAFE_INTEGER])(
      "preserves valid integer alteration %s without imposing musical bounds",
      (alteration) => {
        const gap = chordGap();
        gap.chord[pitch] = { step: "C", alteration };
        const result = apply([gap]);
        expect(result.chords[0]?.[pitch]).toEqual({
          step: "C",
          ...(alteration === 0 ? {} : { alter: alteration }),
        });
        if (Math.abs(alteration) > 128) {
          expect(result.outcomes[0]?.disposition).toBe("handled-partially");
          expect(result.diagnostics[0]?.message).toContain("Unsupported chord");
        } else {
          expect(result.outcomes[0]?.disposition).toBe("handled");
          expect(result.diagnostics).toEqual([]);
        }
      },
    );
  });

  it.each([
    { suffix: "dim", quality: "diminished", bass: false, expected: "Cdim" },
    { suffix: "7", quality: "dominant", bass: true, expected: "C7/E" },
  ])("keeps full harmony when the root is hidden: $expected", ({ suffix, quality, bass, expected }) => {
    const source = document();
    sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
    const gap = chordGap("D", suffix, quality);
    gap.chord.showRoot = false;
    if (bass) gap.chord.bass = { step: "F", alteration: 1 };
    const result = apply([gap], source);
    expect(result.chords[0]).toMatchObject({
      root: { step: "C" },
      kindText: suffix,
      rawText: expected,
    });
    expect(result.chords[0]).not.toHaveProperty("textOverride");
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("supported");
    expect(result.diagnostics[0]?.message).toContain("visibility fields cannot be represented");
    if (bass) expect(result.chords[0]?.bass).toEqual({ step: "E" });
    else expect(result.chords[0]).not.toHaveProperty("bass");
  });

  describe.each([false, true])("presentation casing (lowercase=%s)", (lowerCase) => {
    it.each([
      { showRoot: true, showSuffix: true },
      { showRoot: true, showSuffix: false },
      { showRoot: false, showSuffix: true },
      { showRoot: false, showSuffix: false },
    ])("preserves major-seventh playback ($showRoot/$showSuffix)", ({ showRoot, showSuffix }) => {
      const source = document();
      sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
      const gap = chordGap("d");
      Object.assign(gap.chord, {
        showRoot,
        showSuffix,
        rootLowerCase: lowerCase,
        bassLowerCase: lowerCase,
        bass: { step: "f", alteration: 1 },
      });
      const result = apply([gap], source);
      expect(result.chords[0]).toMatchObject({
        root: { step: "C" },
        bass: { step: "E" },
        quality: "major",
        extension: 7,
        kindText: "maj7",
        rawText: "Cmaj7/E",
      });
      expect(resolveChordSymbol(result.chords[0]!)).toEqual({
        status: "supported",
        rootPitchClass: 0,
        bassPitchClass: 4,
        pitchClasses: [0, 4, 7, 11],
      });
      expect(voiceChordSymbol(result.chords[0]!)).toEqual({ leftHand: [40], rightHand: [60, 64, 67, 71] });
      expect(result.chords[0]).not.toHaveProperty("textOverride");
      expect(formatChordSymbolText(result.chords[0]!)).toBe("Cmaj7/E");
      if (!showRoot || !showSuffix) {
        expect(result.outcomes[0]?.disposition).toBe("handled-partially");
        expect(result.diagnostics[0]?.message).toContain("visibility fields cannot be represented");
      }
      expect(result.diagnostics.every((entry) => !entry.message.includes("Unsupported chord"))).toBe(true);
    });
  });

  it("retains an equivalent hidden empty suffix without changing harmony", () => {
    const gap = chordGap("C", "", "major");
    gap.chord.showSuffix = false;
    const result = apply([gap]);
    expect(result.chords[0]).toMatchObject({ rawText: "C" });
    expect(result.chords[0]).not.toHaveProperty("textOverride");
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("supported");
  });

  it.each([
    { showRoot: false, showSuffix: true },
    { showRoot: true, showSuffix: false },
    { showRoot: false, showSuffix: false },
  ])("keeps full Cmaj7 with no slash bass ($showRoot/$showSuffix)", (visibility) => {
    const gap = chordGap();
    Object.assign(gap.chord, visibility);
    const result = apply([gap]);
    expect(result.chords[0]).toMatchObject({ rawText: "Cmaj7", quality: "major", extension: 7 });
    expect(result.chords[0]).not.toHaveProperty("textOverride");
    expect(result.chords[0]).not.toHaveProperty("bass");
    expect(voiceChordSymbol(result.chords[0]!)).toEqual({ leftHand: [36], rightHand: [60, 64, 67, 71] });
    expect(result.diagnostics[0]?.message).toContain("visibility fields cannot be represented");
  });

  it.each(["vertical", "diagonal"] as const)(
    "does not treat %s bass layout as unsupported harmony",
    (bassArrangement) => {
      const gap = chordGap();
      Object.assign(gap.chord, { bassArrangement, bass: { step: "e", alteration: -1 }, bassLowerCase: true });
      const result = apply([gap]);
      expect(result.chords[0]).toMatchObject({
        rawText: "Cmaj7/Eb",
        bass: { step: "E", alter: -1 },
      });
      expect(result.chords[0]).not.toHaveProperty("textOverride");
      expect(formatChordSymbolText(result.chords[0]!)).toBe("Cmaj7/Eb");
      expect(resolveChordSymbol(result.chords[0]!)).toMatchObject({ status: "supported", bassPitchClass: 3 });
      expect(result.diagnostics[0]?.message).toContain("Finale suffix typography");
    },
  );

  it.each([
    { strings: [{ text: "maj7", position: "above" as const }] },
    { strings: [{ text: "maj7", position: "below" as const }] },
    { parenthesizeDegrees: true },
    { stackDegrees: true },
    { hasOuterParentheses: true },
    { hasUnrecognizedGlyphs: true },
  ])("keeps supported music despite display-only suffix metadata: %j", (presentation) => {
    const gap = chordGap();
    Object.assign(gap.chord.suffix, presentation);
    const result = apply([gap]);
    expect(result.chords[0]).toMatchObject({ rawText: "Cmaj7" });
    expect(result.chords[0]).not.toHaveProperty("textOverride");
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("supported");
    expect(result.outcomes[0]?.disposition).toBe("handled-partially");
    expect(result.diagnostics[0]?.message).toContain("Finale suffix typography");
  });

  it("preserves diatonic spelling for transposed flats and a lowered slash bass", () => {
    const source = document();
    sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
    const gap = chordGap("B", "7", "dominant");
    gap.chord.root.alteration = -1;
    gap.chord.bass = { step: "D", alteration: -1 };
    const result = apply([gap], source);
    expect(result.chords[0]).toMatchObject({
      root: { step: "A", alter: -1 },
      bass: { step: "C", alter: -1 },
      rawText: "Ab7/Cb",
    });
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("supported");
  });

  it("normalizes each source before deduplicating enharmonically equivalent slash chords", () => {
    const source = document(2);
    sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
    const upper = chordGap("D");
    upper.chord.bass = { step: "F", alteration: 1 };
    const lower = chordGap("B", "M7", "major-seventh");
    lower.anchor = "P2.m1";
    lower.chord.root.alteration = 1;
    lower.chord.bass = { step: "F", alteration: -1 };
    const result = apply([lower, upper], source);
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]?.rawText).toBe("Cmaj7/E");
    expect(result.diagnostics).toEqual([]);
  });

  it("ranks source parts then source staves, regardless of gap ordering", () => {
    const source = document(2);
    sourcePart(source)["staves"] = 2;
    const upper = chordGap("C");
    upper.staff = 1;
    upper.position = { numerator: 1, denominator: 2 };
    const lowerStaff = chordGap("D");
    lowerStaff.staff = 2;
    lowerStaff.position = { numerator: 2, denominator: 4 };
    const lowerPart = chordGap("E");
    lowerPart.anchor = "P2.m1";
    lowerPart.position = { numerator: 3, denominator: 6 };
    const result = apply([lowerPart, lowerStaff, upper], source);
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]?.root).toEqual({ step: "C" });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((entry) => entry.message.includes("discarded different harmony"))).toBe(true);
    expect(result.document.parts.every((part) => part._x?.viritura?.chordSymbolVisibility === "show")).toBe(true);
  });

  it("silently merges equal rational onsets but retains near-equal distinct rational onsets", () => {
    const first = chordGap();
    first.position = { numerator: 1, denominator: 3 };
    const duplicate = chordGap("C", "M7", "major-seventh");
    duplicate.staff = 2;
    duplicate.position = { numerator: 2, denominator: 6 };
    const near = chordGap("G");
    near.position = { numerator: 1_000_000_000, denominator: 3_000_000_001 };
    const result = apply([duplicate, first, near]);
    expect(result.chords).toHaveLength(2);
    expect(result.chords.map((chord) => chord.position.fraction)).toEqual([
      [1_000_000_000, 3_000_000_001],
      [1, 3],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("replaces only incoming positions, retaining other existing global harmony and extensions", () => {
    const source = document();
    const retained: ChordSymbol = { position: { fraction: [3, 4] }, rawText: "NC" };
    globalMeasure(source)["_x"] = {
      viritura: {
        rehearsalMark: { text: "A" },
        chordSymbols: [
          retained,
          { position: { fraction: [1, 2] }, root: { step: "G" } },
          { position: { fraction: [2, 4] }, root: { step: "A" } },
        ],
      },
      anotherVendor: { retained: true },
    };
    const gap = chordGap();
    gap.position = { numerator: 4, denominator: 8 };
    const result = apply([gap], source);
    expect(result.chords).toEqual([expect.objectContaining({ root: { step: "C" } }), retained]);
    expect(result.document.global.measures[0]?._x?.viritura?.rehearsalMark).toEqual({ text: "A" });
    expect(result.document.global.measures[0]?._x).toHaveProperty("anotherVendor.retained", true);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([true, false])("keeps unsupported music even when hidden (visible=%s)", (visible) => {
    const source = document();
    sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
    const gap = chordGap("D", "7alt", "dominant");
    gap.chord.suffix.stackDegrees = true;
    gap.chord.showRoot = visible;
    gap.chord.showSuffix = visible;
    gap.chord.bass = { step: "F", alteration: 1 };
    const result = apply([gap], source);
    expect(result.chords[0]).toMatchObject({
      root: { step: "C" },
      bass: { step: "E" },
      rawText: "C7alt/E",
    });
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("unsupported");
    expect(result.chords[0]).not.toHaveProperty("textOverride");
    expect(formatChordSymbolText(result.chords[0]!)).toBe("C7alt/E");
    expect(result.outcomes[0]?.disposition).toBe("handled-partially");
    expect(result.diagnostics[0]?.message).toContain("Unsupported chord");
  });

  it.each([true, false])("does not drop explicit degree alterations (visible=%s)", (visible) => {
    const gap = chordGap("C", "", "major");
    gap.chord.showRoot = visible;
    gap.chord.showSuffix = visible;
    gap.chord.suffix.degrees = [{ value: 5, alteration: 1, type: "alter", impliedByText: false }];
    const result = apply([gap]);
    expect(result.chords[0]?.rawText).toBe("C");
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("unsupported");
    expect(result.diagnostics[0]?.message).toContain("Unsupported chord");
  });

  it.each([true, false])("retains implied suspended-seventh semantics (visible=%s)", (visible) => {
    const gap = chordGap("C", "7sus4", "suspended-fourth");
    gap.chord.showRoot = visible;
    gap.chord.showSuffix = visible;
    gap.chord.suffix.degrees = [{ value: 7, alteration: 0, type: "add", impliedByText: true }];
    const result = apply([gap]);
    expect(result.chords[0]?.extension).toBe(7);
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("supported");
    expect(result.chords[0]?.rawText).toBe("C7sus4");
    expect(result.diagnostics.every((entry) => !entry.message.includes("Unsupported chord"))).toBe(true);
  });

  it.each([true, false])("normalizes minor seventh with flattened fifth (visible=%s)", (visible) => {
    const gap = chordGap("C", "m7b5", "minor-seventh");
    gap.chord.showRoot = visible;
    gap.chord.showSuffix = visible;
    gap.chord.suffix.degrees = [{ value: 5, alteration: -1, type: "alter", impliedByText: false }];
    const result = apply([gap]);
    expect(result.chords[0]?.quality).toBe("half-diminished");
    expect(resolveChordSymbol(result.chords[0]!)).toMatchObject({
      status: "supported",
      pitchClasses: [0, 3, 6, 10],
    });
    expect(result.chords[0]?.rawText).toBe("Cm7b5");
    expect(result.diagnostics.every((entry) => !entry.message.includes("Unsupported chord"))).toBe(true);
  });

  it.each([true, false])("does not legitimize contradictory implied degrees (visible=%s)", (visible) => {
    const gap = chordGap("C", "7sus4", "suspended-fourth");
    gap.chord.showRoot = visible;
    gap.chord.showSuffix = visible;
    gap.chord.suffix.degrees = [{ value: 7, alteration: 1, type: "add", impliedByText: true }];
    const result = apply([gap]);
    expect(result.chords[0]?.rawText).toBe("C7sus4");
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("unsupported");
    expect(result.diagnostics[0]?.message).toContain("Unsupported chord");
  });

  it.each([false, true])("preserves NC as silent, not unsupported or a major chord (transposing=%s)", (transposing) => {
    const source = document();
    if (transposing) sourcePart(source)["transposition"] = { interval: { halfSteps: 2, staffDistance: 1 } };
    const gap = chordGap("C", "N.C.", "none");
    gap.chord.showRoot = false;
    const result = apply([gap], source);
    expect(result.chords[0]).toEqual({ position: { fraction: [0, 1] }, rawText: "N.C." });
    expect(resolveChordSymbol(result.chords[0]!)).toEqual({ status: "silent" });
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps hidden N.C. silent while diagnosing its lost visibility", () => {
    const gap = chordGap("C", "N.C.", "none");
    gap.chord.showRoot = false;
    gap.chord.showSuffix = false;
    const result = apply([gap]);
    expect(result.chords[0]).toEqual({ position: { fraction: [0, 1] }, rawText: "N.C." });
    expect(resolveChordSymbol(result.chords[0]!)).toEqual({ status: "silent" });
    expect(result.diagnostics[0]?.message).toContain("visibility fields cannot be represented");
  });

  it.each([
    { showRoot: true },
    { bass: { step: "E", alteration: 0 } },
    { suffix: { degrees: [{ value: 5, alteration: 1, type: "alter", impliedByText: false }] } },
  ])("does not interpret contradictory N.C. metadata as silence: %j", (contradiction) => {
    const gap = chordGap("C", "N.C.", "none");
    gap.chord.showRoot = false;
    const { suffix, ...fields } = contradiction;
    Object.assign(gap.chord, fields);
    Object.assign(gap.chord.suffix, suffix);
    const result = apply([gap]);
    expect(resolveChordSymbol(result.chords[0]!).status).toBe("unsupported");
    expect(result.diagnostics[0]?.message).toContain("Unsupported chord");
  });

  it.each([
    { interval: { halfSteps: 2 } },
    { interval: { halfSteps: "2", staffDistance: 1 } },
    { interval: { halfSteps: 2, staffDistance: 0.5 } },
    null,
  ])("rejects malformed source transposition rather than guessing concert pitch: %j", (transposition) => {
    const source = document();
    sourcePart(source)["transposition"] = transposition;
    expect(() => apply([chordGap()], source)).toThrow("Invalid source MNX part transposition");
  });

  it.each([0, -1, 0.5])("rejects invalid rhythmic denominators: %s", (denominator) => {
    const gap = chordGap();
    gap.position = { numerator: 1, denominator };
    expect(() => apply([gap])).toThrow();
  });

  it.each([
    null,
    {},
    [null],
    [{ position: { fraction: [0, 1] } }],
    [{ position: { fraction: [0, 1] }, root: { step: "C" }, quality: 42 }],
    [{ position: { fraction: [0, 1] }, root: { step: "C" }, extension: "7" }],
  ])("does not turn invalid existing global chord structure into an unsupported-chord warning: %j", (chordSymbols) => {
    const source = document();
    globalMeasure(source)["_x"] = { viritura: { chordSymbols } };
    expect(() => apply([chordGap()], source)).toThrow();
  });

  it("does not swallow malformed vendor containers", () => {
    const source = document();
    sourcePart(source)["_x"] = { viritura: "invalid" };
    expect(() => apply([chordGap()], source)).toThrow("Expected viritura to be an object");
  });
});

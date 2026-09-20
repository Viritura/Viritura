import { describe, expect, it } from "vitest";
import {
  formatChordSymbolText,
  mergeGlobalChordSymbols,
  resolveChordSymbol,
  transposeChordSymbol,
  voiceChordSymbol,
  type ChordSymbol,
} from "@viritura/core";
import { readMuseScoreClipboard, writeMuseScoreStaffList } from ".";

// MuseScore v4.7.5 writeHarmonyInfo transports concert TPCs, even on a transposing staff.
// These source literals are independent of the clipboard writer.
function source(name: string, structured: boolean, root = 12, bass = 13): string {
  return `<StaffList version="4.70" tick="1/1" len="1/4" staff="3" staves="1">
    <Staff id="3">
      <transposeChromatic>-2</transposeChromatic><transposeDiatonic>-1</transposeDiatonic>
      <voiceOffset><voice id="0">0</voice></voiceOffset>
      <location><fractions>1/1</fractions></location>
      <Harmony><harmonyInfo><name>${name}</name>${structured ? `<root>${root}</root><bass>${bass}</bass>` : ""}</harmonyInfo></Harmony>
      <Rest><durationType>quarter</durationType></Rest>
    </Staff>
  </StaffList>`;
}

const ALIASES = [
  { alias: "min7", canonical: "m7", quality: "minor", extension: 7 },
  { alias: "-9", canonical: "m9", quality: "minor", extension: 9 },
  { alias: "M7", canonical: "maj7", quality: "major", extension: 7 },
  { alias: "ma9", canonical: "maj9", quality: "major", extension: 9 },
  { alias: "Δ", canonical: "maj7", quality: "major", extension: 7 },
  { alias: "△9", canonical: "maj9", quality: "major", extension: 9 },
  { alias: "o7", canonical: "dim7", quality: "diminished", extension: 7 },
  { alias: "°", canonical: "dim", quality: "diminished" },
  { alias: "+", canonical: "aug", quality: "augmented" },
  { alias: "m7b5", canonical: "ø7", quality: "half-diminished", extension: 7 },
  { alias: "0", canonical: "ø7", quality: "half-diminished", extension: 7 },
  { alias: "-Δ", canonical: "mMaj7", quality: "minor-major", extension: 7 },
  { alias: "7sus", canonical: "7sus4", quality: "suspended4", extension: 7 },
] satisfies { alias: string; canonical: string; quality: ChordSymbol["quality"]; extension?: number }[];

describe.each([true, false])("MuseScore chord aliases (structured source: %s)", (structured) => {
  it.each(ALIASES)("retains $alias provenance without making it a display override", (entry) => {
    const rawText = `Bb${entry.alias}/F`;
    const data = readMuseScoreClipboard(source(structured ? entry.alias : rawText, structured));
    const captured = data.chordSymbols![0]!;
    const symbol = captured.chordSymbol;
    expect(captured).toMatchObject({ partOffset: 0, staffOffset: 0, measureOffset: 0, offset: [0, 1] });
    expect(symbol).toMatchObject({
      position: { fraction: [0, 1] },
      root: { step: "B", alter: -1 },
      bass: { step: "F" },
      quality: entry.quality,
      rawText,
    });
    expect(symbol.extension).toBe("extension" in entry ? entry.extension : undefined);
    expect(symbol).not.toHaveProperty("textOverride");
    expect(resolveChordSymbol(symbol).status).toBe("supported");
    expect(data.diagnostics).toBeUndefined();
    const original = structuredClone(data);
    const written = transposeChordSymbol(symbol, data.transposition!.interval);
    expect(written.rawText).toBe(`C${entry.alias}/G`);
    const exported = writeMuseScoreStaffList({ events: data.content, chordSymbols: data.chordSymbols });
    expect(exported.warning).toBeUndefined();
    expect(exported.xml).toContain(`<name>${entry.canonical}</name><root>12</root><bass>13</bass>`);
    const restored = readMuseScoreClipboard(exported.xml!).chordSymbols![0]!.chordSymbol;
    expect(restored.rawText).toBe(`Bb${entry.canonical}/F`);
    expect(resolveChordSymbol(restored)).toEqual(resolveChordSymbol(symbol));
    expect(data).toEqual(original);
    expect(formatChordSymbolText(symbol)).toBe(`Bb${entry.canonical}/F`);
    expect(formatChordSymbolText(written)).toBe(`C${entry.canonical}/G`);
  });
});

const MODIFIERS = [
  { alias: "add79omit5", canonical: "add7add9omit5", quality: "major", pitches: [0, 2, 4, 10] },
  { alias: "(add7,9,no5)", canonical: "add7add9omit5", quality: "major", pitches: [0, 2, 4, 10] },
  { alias: "add(7,9)omit5", canonical: "add7add9omit5", quality: "major", pitches: [0, 2, 4, 10] },
  { alias: "add9", canonical: "add9", quality: "major", pitches: [0, 2, 4, 7] },
  { alias: "add13", canonical: "add13", quality: "major", pitches: [0, 4, 7, 9] },
  { alias: "maj7add9", canonical: "maj7add9", quality: "major", extension: 7, pitches: [0, 2, 4, 7, 11] },
  { alias: "M7(add9)", canonical: "maj7add9", quality: "major", extension: 7, pitches: [0, 2, 4, 7, 11] },
  { alias: "min7add9", canonical: "m7add9", quality: "minor", extension: 7, pitches: [0, 2, 3, 7, 10] },
  { alias: "no3", canonical: "omit3", quality: "major", pitches: [0, 7] },
  { alias: "add6", canonical: "6", quality: "major", extension: 6, pitches: [0, 4, 7, 9] },
] satisfies {
  alias: string;
  canonical: string;
  quality: ChordSymbol["quality"];
  extension?: ChordSymbol["extension"];
  pitches: number[];
}[];

describe.each([true, false])("MuseScore modifiers (structured source: %s)", (structured) => {
  it.each(MODIFIERS)("imports $alias without losing degrees or transposing concert TPCs", (entry) => {
    const rawText = `C${entry.alias}/E`;
    const data = readMuseScoreClipboard(source(structured ? entry.alias : rawText, structured, 14, 18));
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol).toEqual({
      position: { fraction: [0, 1] },
      root: { step: "C" },
      bass: { step: "E" },
      quality: entry.quality,
      ...("extension" in entry ? { extension: entry.extension } : {}),
      ...(entry.alias === "add6" ? {} : { kindText: entry.alias }),
      rawText,
    });
    expect(data.diagnostics).toBeUndefined();
    expect(resolveChordSymbol(symbol)).toEqual({
      status: "supported",
      rootPitchClass: 0,
      bassPitchClass: 4,
      pitchClasses: entry.pitches,
    });
    expect(voiceChordSymbol(symbol)).toEqual({ leftHand: [40], rightHand: entry.pitches.map((pitch) => 60 + pitch) });
    const original = structuredClone(data);
    const written = transposeChordSymbol(symbol, data.transposition!.interval);
    expect(written).toMatchObject({ root: { step: "D" }, bass: { step: "F", alter: 1 } });
    expect(formatChordSymbolText(written)).toBe(`D${entry.canonical}/F#`);
    const exported = writeMuseScoreStaffList({
      events: data.content,
      tracks: data.tracks,
      chordSymbols: data.chordSymbols,
    });
    expect(exported.warning).toBeUndefined();
    expect(exported.xml).toContain(`<name>${entry.canonical}</name><root>14</root><bass>18</bass>`);
    const restored = readMuseScoreClipboard(exported.xml!).chordSymbols![0]!.chordSymbol;
    expect(formatChordSymbolText(restored)).toBe(`C${entry.canonical}/E`);
    expect(resolveChordSymbol(restored)).toEqual(resolveChordSymbol(symbol));
    expect(voiceChordSymbol(restored)).toEqual(voiceChordSymbol(symbol));
    expect(data).toEqual(original);
  });
});

describe.each([true, false])("MuseScore modifier export (raw-only: %s)", (rawOnly) => {
  it.each(MODIFIERS)("serializes the complete semantic $alias suffix", (entry) => {
    const data = readMuseScoreClipboard(source("", true));
    const chord: ChordSymbol = {
      position: { fraction: [0, 1] },
      rawText: `C${entry.alias}/E`,
      ...(rawOnly
        ? {}
        : {
            root: { step: "C" },
            bass: { step: "E" },
            quality: entry.quality,
            ...("extension" in entry ? { extension: entry.extension } : {}),
            ...(entry.alias === "add6" ? {} : { kindText: entry.alias }),
          }),
    };
    const original = structuredClone(chord);
    const exported = writeMuseScoreStaffList({
      events: data.content,
      tracks: data.tracks,
      chordSymbols: [{ ...data.chordSymbols![0]!, chordSymbol: chord }],
    });
    expect(exported.warning).toBeUndefined();
    expect(exported.xml).toContain(`<name>${entry.canonical}</name><root>14</root><bass>18</bass>`);
    const restored = readMuseScoreClipboard(exported.xml!).chordSymbols![0]!.chordSymbol;
    expect(restored).toMatchObject({ root: { step: "C" }, bass: { step: "E" } });
    expect(resolveChordSymbol(restored)).toEqual({
      status: "supported",
      rootPitchClass: 0,
      bassPitchClass: 4,
      pitchClasses: entry.pitches,
    });
    expect(resolveChordSymbol(restored)).toEqual(resolveChordSymbol(chord));
    expect(voiceChordSymbol(restored)).toEqual({ leftHand: [40], rightHand: entry.pitches.map((pitch) => 60 + pitch) });
    expect(chord).toEqual(original);
  });
});

describe("MuseScore harmony provenance boundaries", () => {
  it("preserves rootless source whitespace and accidental spelling without displaying it", () => {
    const data = readMuseScoreClipboard(source("  b♭min7/f  ", false));
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol.rawText).toBe("  b♭min7/f  ");
    expect(symbol).not.toHaveProperty("textOverride");
    expect(formatChordSymbolText(symbol)).toBe("Bbm7/F");
    expect(data.diagnostics).toBeUndefined();
  });

  it("retains provenance when captured harmony is merged into global storage", () => {
    const data = readMuseScoreClipboard(source("min7", true));
    const original = structuredClone(data);
    const merged = mergeGlobalChordSymbols({}, [
      {
        partIndex: 0,
        chordSymbols: data.chordSymbols!.map(({ chordSymbol }) => ({
          ...chordSymbol,
          position: { fraction: [1, 4] },
        })),
      },
    ]);
    expect(merged.warnings).toEqual([]);
    expect(merged.measure.chordSymbols).toHaveLength(1);
    expect(merged.measure.chordSymbols![0]).toMatchObject({
      position: { fraction: [1, 4] },
      rawText: "Bbmin7/F",
    });
    expect(formatChordSymbolText(merged.measure.chordSymbols![0]!)).toBe("Bbm7/F");
    expect(data).toEqual(original);
  });

  it("keeps authored display overrides distinct from imported aliases", () => {
    const data = readMuseScoreClipboard(source("min7", true));
    const symbol = data.chordSymbols![0]!.chordSymbol;
    const authored = { ...symbol, textOverride: "custom chord" };
    expect(formatChordSymbolText(authored)).toBe("custom chord");
    const original = structuredClone(authored);
    const exported = writeMuseScoreStaffList({
      events: data.content,
      chordSymbols: [{ ...data.chordSymbols![0]!, chordSymbol: authored }],
    });
    expect(exported.warning).toContain("unsupported harmony");
    expect(exported.xml).toContain("<harmonyInfo><name>custom chord</name></harmonyInfo>");
    expect(authored).toEqual(original);
  });

  it("does not promote kindText metadata to an authored display override", () => {
    const symbol = readMuseScoreClipboard(source("min7", true)).chordSymbols![0]!.chordSymbol;
    const metadata = { ...symbol, kindText: "min7" };
    expect(resolveChordSymbol(metadata).status).toBe("supported");
    expect(formatChordSymbolText(metadata)).toBe("Bbm7/F");
    expect(formatChordSymbolText({ ...metadata, textOverride: "Bb-7/F" })).toBe("Bb-7/F");
    expect(metadata).not.toHaveProperty("textOverride");
  });

  it.each(["skip", "error"] as const)("keeps unsupported aliases raw and diagnosed in %s mode", (unsupported) => {
    const data = readMuseScoreClipboard(source("7alt", true), undefined, { unsupported });
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol).toMatchObject({ rawText: "Bb7alt/F", quality: "other", kindText: "7alt" });
    expect(symbol).not.toHaveProperty("textOverride");
    expect(formatChordSymbolText(symbol)).toBe("Bb7alt/F");
    expect(resolveChordSymbol(symbol).status).toBe("unsupported");
    expect(data.diagnostics).toHaveLength(1);
    expect(data.diagnostics![0]!.message).toContain("Preserved harmony as rawText");
  });

  it("does not infer supported modifiers from degree XML", () => {
    const xml = source("add9", true).replace(
      "</harmonyInfo>",
      "<degree><degree-value>5</degree-value><degree-alter>0</degree-alter><degree-type>subtract</degree-type></degree></harmonyInfo>",
    );
    const data = readMuseScoreClipboard(xml);
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol.quality).toBe("other");
    expect(resolveChordSymbol(symbol).status).toBe("unsupported");
    expect(voiceChordSymbol(symbol)).toEqual({ leftHand: [], rightHand: [] });
    expect(data.diagnostics![0]!.message).toContain("harmony degrees are not representable");
  });
});

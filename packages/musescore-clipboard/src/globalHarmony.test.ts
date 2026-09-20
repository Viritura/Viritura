import { describe, expect, it } from "vitest";
import {
  formatChordSymbolText,
  mergeGlobalChordSymbols,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  voiceChordSymbol,
  type ChordSymbol,
  type NoteEvent,
} from "@viritura/core";
import { readMuseScoreClipboard, writeMuseScoreStaffList } from ".";

// MuseScore v4.7.5, 3654226c2e99289916916953a98e585a3d3b315a:
// rw/write/twrite.cpp writeHarmonyInfo normalizes both TPCs to concert pitch;
// rw/read460/read460.cpp pasteStaff applies only the destination written interval.
// The literal is independent of our writer: written C7/G on a Bb clarinet
// is transported as sounding Bb7/F, alongside concert note tpc and written tpc2.
const CLARINET_SLASH = `<StaffList version="4.70" tick="0/1" len="1/4" staff="3" staves="1">
  <Staff id="3">
    <transposeChromatic>-2</transposeChromatic><transposeDiatonic>-1</transposeDiatonic>
    <voiceOffset><voice id="0">0</voice></voiceOffset>
    <Harmony><harmonyInfo><name>7</name><root>12</root><bass>13</bass></harmonyInfo></Harmony>
    <Chord><durationType>quarter</durationType><Note><pitch>58</pitch><tpc>12</tpc><tpc2>14</tpc2></Note></Chord>
  </Staff>
</StaffList>`;

function harmony(root: number, name = "7", bass = 13): string {
  return `<Harmony><harmonyInfo><name>${name}</name><root>${root}</root><bass>${bass}</bass></harmonyInfo></Harmony>`;
}

function staffList(harmonies: string): string {
  return `<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="1">
    <Staff id="0"><voiceOffset><voice id="0">0</voice></voiceOffset>${harmonies}
    <Rest><durationType>quarter</durationType></Rest></Staff></StaffList>`;
}

describe("global concert harmony clipboard contract", () => {
  it("does not apply the Bb source interval twice to roots, slash basses, or notes", () => {
    const data = readMuseScoreClipboard(CLARINET_SLASH);
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol).toMatchObject({
      root: { step: "B", alter: -1 },
      bass: { step: "F" },
      quality: "dominant",
      extension: 7,
    });
    expect((data.content[0] as NoteEvent).notes![0]!.pitch).toEqual({ step: "B", octave: 3, alter: -1 });
    expect(data.transposition?.interval).toEqual({ halfSteps: 2, staffDistance: 1 });
    expect(formatChordSymbolText(symbol)).toBe("Bb7/F");
    expect(formatChordSymbolText(transposeChordSymbol(symbol, data.transposition!.interval))).toBe("C7/G");
    expect(resolveChordSymbol(symbol)).toMatchObject({ rootPitchClass: 10, bassPitchClass: 5 });
    expect(data.diagnostics).toBeUndefined();
  });

  it("exports concert global harmony, but written note spelling, in transposing StaffList context", () => {
    const data = readMuseScoreClipboard(CLARINET_SLASH);
    const original = structuredClone(data);
    const result = writeMuseScoreStaffList({
      events: data.content,
      tracks: data.tracks,
      chordSymbols: data.chordSymbols,
    });
    expect(result.warning).toBeUndefined();
    expect(result.xml).toContain("<name>7</name><root>12</root><bass>13</bass>");
    expect(result.xml).toContain("<tpc>12</tpc><tpc2>14</tpc2>");
    expect(readMuseScoreClipboard(result.xml!).chordSymbols).toEqual(data.chordSymbols);
    expect(data).toEqual(original);
  });

  it.each([
    { rawText: "Dbmaj9", tpcs: "<root>9</root>", bass: undefined },
    { rawText: "Dbmaj9/Ab", tpcs: "<root>9</root><bass>10</bass>", bass: { step: "A", alter: -1 } },
  ])("exports supported raw-only $rawText as transposable concert harmony", ({ rawText, tpcs, bass }) => {
    const data = readMuseScoreClipboard(CLARINET_SLASH);
    const chord: ChordSymbol = { rawText, position: { fraction: [0, 1] } };
    const original = structuredClone(chord);
    const result = writeMuseScoreStaffList({
      events: data.content,
      tracks: data.tracks,
      chordSymbols: [{ ...data.chordSymbols![0]!, chordSymbol: chord }],
    });
    expect(result.warning).toBeUndefined();
    expect(result.xml).toContain(`<harmonyInfo><name>maj9</name>${tpcs}</harmonyInfo>`);
    const roundTrip = readMuseScoreClipboard(result.xml!).chordSymbols![0]!.chordSymbol;
    expect(roundTrip.root).toEqual({ step: "D", alter: -1 });
    expect(roundTrip.bass).toEqual(bass);
    expect(roundTrip).toMatchObject({ quality: "major", extension: 9 });
    expect(resolveChordSymbol(roundTrip)).toEqual(resolveChordSymbol(chord));
    expect(formatChordSymbolText(roundTrip)).toBe(rawText);
    expect(chord).toEqual(original);
  });

  it.each([
    "Db7alt/Ab",
    "unknown",
    "H7",
    "  unknown  text  ",
    "=unknown",
    'unknown <&> "text"',
    "unknown\r\ntext",
    "unknown &#13; text",
  ])("preserves unsupported raw-only %s without inventing structured harmony", (rawText) => {
    const data = readMuseScoreClipboard(CLARINET_SLASH);
    const chord: ChordSymbol = { rawText, position: { fraction: [0, 1] } };
    const original = structuredClone(chord);
    const result = writeMuseScoreStaffList({
      events: data.content,
      tracks: data.tracks,
      chordSymbols: [{ ...data.chordSymbols![0]!, chordSymbol: chord }],
    });
    expect(result.warning).toContain("unsupported harmony");
    expect(result.warning).toContain("chordSymbols[0]");
    expect(result.xml).toContain("<Harmony><harmonyInfo><name>");
    expect(result.xml).not.toMatch(/<(?:root|bass)>/);
    for (const unsupported of ["skip", "error"] as const) {
      const roundTrip = readMuseScoreClipboard(result.xml!, undefined, { unsupported });
      expect(roundTrip.chordSymbols![0]!.chordSymbol.rawText).toBe(rawText);
      expect(resolveChordSymbol(roundTrip.chordSymbols![0]!.chordSymbol).status).toBe("unsupported");
      expect(roundTrip.diagnostics).toHaveLength(1);
    }
    expect(chord).toEqual(original);
  });

  it.each(["7sus4", "maj13", "mMaj7", "m7b5"])("uses shared semantics for %s", (name) => {
    const data = readMuseScoreClipboard(staffList(harmony(12, name)));
    expect(resolveChordSymbol(data.chordSymbols![0]!.chordSymbol).status).toBe("supported");
    expect(data.diagnostics).toBeUndefined();
  });

  it.each(["b5", "#5", "b7", "#11"])("never reinterprets suffix %s as an altered root", (name) => {
    const data = readMuseScoreClipboard(staffList(harmony(14, name)));
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol.root).toEqual({ step: "C" });
    expect(symbol.bass).toEqual({ step: "F" });
    expect(symbol.rawText).toBe(`C${name}/F`);
    expect(resolveChordSymbol(symbol).status).toBe("unsupported");
    expect(data.diagnostics).toHaveLength(1);
  });

  it.each([
    { root: 14, name: "b5", bass: "" },
    { root: 14, name: "#5", bass: "<bass>13</bass>" },
    { root: 14, name: "b7", bass: "<bass>12</bass>" },
    { root: 21, name: "#11", bass: "<bass>21</bass>" },
  ])("round-trips ambiguous unsupported suffix $root/$name with authoritative TPCs", ({ root, name, bass }) => {
    const data = readMuseScoreClipboard(
      staffList(`<Harmony><harmonyInfo><name>${name}</name><root>${root}</root>${bass}</harmonyInfo></Harmony>`),
    );
    const symbol = data.chordSymbols![0]!.chordSymbol;
    const original = structuredClone(data);
    expect(resolveChordSymbol(symbol).status).toBe("unsupported");
    const result = writeMuseScoreStaffList({ events: data.content, chordSymbols: data.chordSymbols });
    expect(result.warning).toContain("unsupported harmony");
    expect(result.xml).toContain(`<name>${name}</name><root>${root}</root>${bass}`);
    for (const unsupported of ["skip", "error"] as const) {
      const roundTrip = readMuseScoreClipboard(result.xml!, undefined, { unsupported });
      const restored = roundTrip.chordSymbols![0]!.chordSymbol;
      expect(restored).toEqual(symbol);
      expect(roundTrip.diagnostics).toHaveLength(1);
      expect(resolveChordSymbol(restored).status).toBe("unsupported");
      expect(voiceChordSymbol(restored)).toEqual({ leftHand: [], rightHand: [] });
    }
    expect(data).toEqual(original);
  });

  it.each([
    { root: { step: "C" }, quality: "other", rawText: "C7" },
    { root: { step: "C" }, quality: "other", kindText: "7", rawText: "C7" },
    { root: { step: "C" }, quality: "other", kindText: "b5", rawText: "Db5" },
    { root: { step: "C" }, rawText: "N.C." },
    { rawText: "C7", textOverride: "D7" },
  ])("rejects unsupported harmony whose only export would change meaning: %j", (fields) => {
    const chord = { position: { fraction: [0, 1] }, ...fields } as ChordSymbol;
    expect(resolveChordSymbol(chord).status).toBe("unsupported");
    const result = writeMuseScoreStaffList({
      events: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
      chordSymbols: [{ measureOffset: 0, chordSymbol: chord }],
    });
    expect(result.xml).toBeNull();
    expect(result.warning).toContain("would change meaning");
  });

  it.each(["skip", "error"] as const)("retains unknown suffix and both concert roots in %s mode", (unsupported) => {
    const data = readMuseScoreClipboard(CLARINET_SLASH.replace("<name>7</name>", "<name>7alt</name>"), undefined, {
      unsupported,
    });
    const symbol = data.chordSymbols![0]!.chordSymbol;
    expect(symbol).toMatchObject({
      root: { step: "B", alter: -1 },
      bass: { step: "F" },
      rawText: "Bb7alt/F",
    });
    expect(resolveChordSymbol(symbol).status).toBe("unsupported");
    expect(data.diagnostics).toHaveLength(1);
    const result = writeMuseScoreStaffList({ events: data.content, chordSymbols: data.chordSymbols });
    expect(result.warning).toContain("unsupported harmony");
    expect(result.xml).toContain("<harmonyInfo><name>Bb7alt/F</name></harmonyInfo>");
    const roundTrip = readMuseScoreClipboard(result.xml!, undefined, { unsupported });
    expect(roundTrip.chordSymbols![0]!.chordSymbol.rawText).toBe("Bb7alt/F");
    expect(roundTrip.diagnostics).toHaveLength(1);
  });

  it("retains rootless NC as silent raw text and round-trips it", () => {
    const data = readMuseScoreClipboard(staffList("<Harmony><harmonyInfo><name>N.C.</name></harmonyInfo></Harmony>"));
    expect(data.chordSymbols![0]!.chordSymbol).toEqual({ position: { fraction: [0, 1] }, rawText: "N.C." });
    expect(resolveChordSymbol(data.chordSymbols![0]!.chordSymbol).status).toBe("silent");
    expect(data.diagnostics).toBeUndefined();
    const written = writeMuseScoreStaffList({ events: data.content, chordSymbols: data.chordSymbols });
    expect(written.warning).toBeUndefined();
    expect(written.xml).toContain("<harmonyInfo><name>N.C.</name></harmonyInfo>");
    expect(readMuseScoreClipboard(written.xml!).chordSymbols).toEqual(data.chordSymbols);
  });

  it.each([
    { root: { step: "H" }, rawText: "H7" },
    { root: { step: "H" }, quality: "dominant" as const, extension: 7 as const },
    { root: { step: "C" }, bass: { step: "H" }, rawText: "C/H" },
    { root: { step: "D", alter: -1 }, quality: "other" as const, kindText: "7alt", bass: { step: "A", alter: -1 } },
  ])("exports unrecognized structured music as name-only harmony: %j", (fields) => {
    const chord: ChordSymbol = { position: { fraction: [1, 8] }, ...fields };
    const original = structuredClone(chord);
    const result = writeMuseScoreStaffList({
      events: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
      chordSymbols: [{ measureOffset: 0, chordSymbol: chord }],
    });
    expect(result.warning).toContain("unsupported harmony");
    expect(result.xml).not.toMatch(/<(?:root|bass)>/);
    const roundTrip = readMuseScoreClipboard(result.xml!);
    expect(roundTrip.chordSymbols![0]!.chordSymbol).toMatchObject({
      rawText: formatChordSymbolText(chord),
    });
    expect(roundTrip.chordSymbols![0]!.offset).toEqual(chord.position.fraction);
    expect(roundTrip.diagnostics).toHaveLength(1);
    expect(chord).toEqual(original);
  });

  it.each([
    { root: {} },
    { root: null },
    { root: "H" },
    { root: { step: 7 } },
    { root: { step: "" } },
    { root: { step: "C", alter: 0.5 } },
    { root: { step: "H", alter: NaN } },
    { bass: { step: "C", alter: "1" } },
    { bass: { step: "C", alter: Infinity } },
    { quality: 123 },
    { extension: NaN },
    { extension: "7" },
    { kindText: {} },
    { textOverride: null },
    { rawText: 123 },
    { position: { fraction: [0, 0] } },
    { position: { fraction: [0.5, 4] } },
    { position: { fraction: [NaN, 4] } },
    { position: { fraction: [0] } },
    { position: { fraction: [0, 1, 2] } },
    { position: { fraction: ["0", 1] } },
    { position: {} },
  ])("does not hide malformed export fields behind raw text: %j", (fields) => {
    const chord = { position: { fraction: [0, 1] }, rawText: "Db7alt/Ab", ...fields } as ChordSymbol;
    const result = writeMuseScoreStaffList({
      events: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
      chordSymbols: [{ measureOffset: 0, offset: [0, 1], chordSymbol: chord }],
    });
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/invalid harmony|invalid fraction/);
    expect(result.warning).not.toContain("preserved as raw text");
  });

  it.each(["unknown\u0000text", "unknown\u000btext", "unknown\ud800text"])(
    "does not export XML-illegal harmony text %j",
    (rawText) => {
      const result = writeMuseScoreStaffList({
        events: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
        chordSymbols: [{ measureOffset: 0, chordSymbol: { position: { fraction: [0, 1] }, rawText } }],
      });
      expect(result).toMatchObject({ xml: null, warning: expect.stringContaining("illegal XML") });
    },
  );

  it.each([
    [0, 0],
    [0.5, 4],
    [-1, 4],
  ] as [number, number][])("still rejects invalid annotation offsets %j", (numerator, denominator) => {
    const result = writeMuseScoreStaffList({
      events: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
      chordSymbols: [
        {
          measureOffset: 0,
          offset: [numerator, denominator],
          chordSymbol: { position: { fraction: [0, 1] }, rawText: "unknown" },
        },
      ],
    });
    expect(result.xml).toBeNull();
    expect(result.warning).toMatch(/invalid fraction|before the copied range/);
  });

  it("collects every fallback warning without warning for supported or silent harmony", () => {
    const chordSymbols = ["Dbmaj9/Ab", "Db7alt/Ab", "N.C.", "unknown"].map((rawText) => ({
      measureOffset: 0,
      chordSymbol: { position: { fraction: [0, 1] as [number, number] }, rawText },
    }));
    const result = writeMuseScoreStaffList({
      events: [{ type: "event", duration: { base: "quarter" }, rest: {} }],
      chordSymbols,
    });
    expect(result.warning?.split("\n")).toEqual([
      expect.stringContaining("chordSymbols[1]"),
      expect.stringContaining("chordSymbols[3]"),
    ]);
    const roundTrip = readMuseScoreClipboard(result.xml!);
    expect(roundTrip.chordSymbols!.map(({ chordSymbol }) => formatChordSymbolText(chordSymbol))).toEqual(
      chordSymbols.map(({ chordSymbol }) => chordSymbol.rawText),
    );
    expect(roundTrip.diagnostics).toHaveLength(2);
  });

  it("does not recover unrelated notation export limitations alongside raw harmony", () => {
    const result = writeMuseScoreStaffList({
      events: [{ type: "event", duration: { base: "quarter" }, rest: {}, fermata: {} }],
      chordSymbols: [
        {
          measureOffset: 0,
          chordSymbol: { position: { fraction: [0, 1] }, rawText: "unknown" },
        },
      ],
    });
    expect(result).toMatchObject({ xml: null, warning: expect.stringContaining("fermatas") });
  });

  it.each(["skip", "error"] as const)("does not recover malformed unsupported harmony in %s mode", (unsupported) => {
    expect(() =>
      readMuseScoreClipboard(staffList(harmony(12, "7alt").replace("<bass>13</bass>", "<bass>bad</bass>")), undefined, {
        unsupported,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-structure" }));
  });

  it.each([
    { lowerRoot: 12, lowerName: "7", warnings: 0 },
    { lowerRoot: 24, lowerName: "7", warnings: 0 },
    { lowerRoot: 12, lowerName: "dom7", warnings: 1 },
    { lowerRoot: 14, lowerName: "7", warnings: 1 },
  ])(
    "preserves physical origins for topmost exact-position global merge: $lowerRoot/$lowerName",
    ({ lowerRoot, lowerName, warnings }) => {
      // Lower staff deliberately occurs first in XML. StaffList has no part boundaries:
      // partOffset is zero for both, so consumers must rank by staffOffset.
      const data = readMuseScoreClipboard(`<StaffList version="4.70" tick="0/1" len="1/4" staff="0" staves="2">
      <Staff id="1"><voiceOffset><voice id="0">0</voice></voiceOffset>${harmony(lowerRoot, lowerName)}
      <Rest><durationType>quarter</durationType></Rest></Staff>
      <Staff id="0"><voiceOffset><voice id="0">0</voice></voiceOffset><location><fractions>-1/4</fractions></location>
      ${harmony(12)}<Rest><durationType>quarter</durationType></Rest></Staff></StaffList>`);
      expect(data.chordSymbols!.map((capture) => capture.staffOffset)).toEqual([1, 0]);
      const existing = {
        chordSymbols: [
          parseChordSymbolText("Dm", { fraction: [1, 8] }),
          parseChordSymbolText("G", { fraction: [1, 3] }),
        ],
      };
      const before = structuredClone(existing);
      const merged = mergeGlobalChordSymbols(
        existing,
        data.chordSymbols!.map((capture) => ({
          partIndex: capture.staffOffset!,
          chordSymbols: [{ ...capture.chordSymbol, position: { fraction: capture.staffOffset ? [2, 6] : [1, 3] } }],
        })),
      );
      expect(merged.measure.chordSymbols!.map(formatChordSymbolText)).toEqual(["Dm", "Bb7/F"]);
      expect(merged.warnings).toHaveLength(warnings);
      expect(existing).toEqual(before);
      expect(data.chordSymbols).toHaveLength(2);
    },
  );
});

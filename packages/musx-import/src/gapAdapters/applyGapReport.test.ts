import { describe, expect, it } from "vitest";
import type { DenigmaGap, DenigmaGapReport } from "../types";
import { applyDenigmaGapReport } from "./applyGapReport";
import { isRecord, type JsonRecord } from "./types";

function document() {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m1",
          time: { count: 4, unit: 4 },
          tempos: [{ id: "tempo-1", bpm: 120, value: { base: "quarter" } }],
        },
      ],
    },
    parts: [
      {
        id: "P1",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ id: "ev1n1", pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    id: "ev2",
                    duration: { base: "quarter" },
                    notes: [{ id: "ev2n1", pitch: { step: "D", octave: 4 } }],
                  },
                  {
                    id: "ev3",
                    duration: { base: "half" },
                    notes: [{ id: "ev3n1", pitch: { step: "E", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function report(gaps: DenigmaGap[]): DenigmaGapReport {
  return {
    schemaVersion: 1,
    producer: { name: "denigma", version: "4.0.0", commit: "5864f4e" },
    gaps,
  };
}

function apply(gaps: DenigmaGap[]) {
  const result = applyDenigmaGapReport(JSON.stringify(document()), report(gaps));
  return { ...result, document: JSON.parse(result.mnxJson) as unknown };
}

function firstEvent(value: unknown): JsonRecord {
  if (!isRecord(value) || !Array.isArray(value["parts"])) throw new Error("Expected parts.");
  const part = value["parts"][0];
  if (!isRecord(part) || !Array.isArray(part["measures"])) throw new Error("Expected measures.");
  const measure = part["measures"][0];
  if (!isRecord(measure) || !Array.isArray(measure["sequences"])) throw new Error("Expected sequences.");
  const sequence = measure["sequences"][0];
  if (!isRecord(sequence) || !Array.isArray(sequence["content"]) || !isRecord(sequence["content"][0])) {
    throw new Error("Expected first event.");
  }
  return sequence["content"][0];
}

function noteAt(value: unknown, eventIndex: number): JsonRecord {
  if (!isRecord(value) || !Array.isArray(value["parts"])) throw new Error("Expected parts.");
  const part = value["parts"][0];
  if (!isRecord(part) || !Array.isArray(part["measures"])) throw new Error("Expected measures.");
  const measure = part["measures"][0];
  if (!isRecord(measure) || !Array.isArray(measure["sequences"])) throw new Error("Expected sequences.");
  const sequence = measure["sequences"][0];
  if (!isRecord(sequence) || !Array.isArray(sequence["content"])) throw new Error("Expected content.");
  const event = sequence["content"][eventIndex];
  if (!isRecord(event) || !Array.isArray(event["notes"]) || !isRecord(event["notes"][0])) {
    throw new Error("Expected pitched note.");
  }
  return event["notes"][0];
}

function viritura(owner: JsonRecord): JsonRecord {
  const extensions = owner["_x"];
  if (!isRecord(extensions) || !isRecord(extensions["viritura"])) {
    throw new Error("Expected Viritura extensions.");
  }
  return extensions["viritura"];
}

describe("applyDenigmaGapReport", () => {
  it("rejects invalid source MNX before applying gaps", () => {
    expect(() => applyDenigmaGapReport("{}", report([]))).toThrow("Denigma returned invalid MNX");
  });

  it("preserves generic and technique text without duplicating an occurrence", () => {
    const generic: DenigmaGap = {
      anchor: "P1.m1",
      position: { numerator: 0, denominator: 1 },
      extent: "complete",
      type: "expression",
      expression: {
        type: "generic-text",
        scope: "staff",
        text: { plain: "dolce" },
        genericText: { text: "dolce" },
      },
    };
    const technique: DenigmaGap = {
      anchor: "P1.m1",
      position: { numerator: 1, denominator: 4 },
      extent: "complete",
      type: "expression",
      expression: {
        type: "technique-text",
        scope: "staff",
        text: { plain: "pizz." },
        technique: { type: "pizzicato", text: "pizz." },
      },
    };

    const result = apply([generic, generic, technique]);
    const parsed = JSON.parse(result.mnxJson) as {
      parts: Array<{ measures: Array<JsonRecord> }>;
    };
    expect(viritura(parsed.parts[0]!.measures[0]!)["expressions"]).toEqual([
      { text: "dolce", position: { fraction: [0, 1] } },
      { text: "pizz.", position: { fraction: [1, 4] } },
    ]);
    expect(result.outcomes.map((entry) => entry.disposition)).toEqual([
      "handled-partially",
      "handled-partially",
      "handled-partially",
    ]);
  });

  it("preserves rehearsal marks and reports an additional mark", () => {
    const rehearsal = (text: string): DenigmaGap => ({
      anchor: "m1",
      position: { numerator: 0, denominator: 1 },
      placements: [{ kind: "system-top", anchor: "m1" }],
      extent: "complete",
      type: "expression",
      expression: {
        type: "rehearsal-mark",
        scope: "top-staff",
        text: { plain: text },
        rehearsalMark: { text },
      },
    });

    const result = apply([rehearsal("A"), rehearsal("B")]);
    const parsed = JSON.parse(result.mnxJson) as { global: { measures: JsonRecord[] } };
    expect(viritura(parsed.global.measures[0]!)["rehearsalMark"]).toEqual({ text: "A" });
    expect(result.outcomes[1]?.disposition).toBe("handled-partially");
  });

  it("preserves ordinary chord semantics and flattens rich suffix typography", () => {
    const simple: DenigmaGap = {
      anchor: "P1.m1",
      position: { numerator: 0, denominator: 1 },
      extent: "complete",
      type: "chord-symbol",
      chord: {
        root: { step: "C", alteration: 0 },
        rootLowerCase: false,
        showRoot: true,
        showSuffix: true,
        suffix: {
          strings: [{ text: "maj7", position: "inline" }],
          suffixText: "maj7",
          degrees: [],
          parenthesizeDegrees: false,
          stackDegrees: false,
          hasOuterParentheses: false,
          hasUnrecognizedGlyphs: false,
          quality: "major-seventh",
        },
      },
    };
    const rich: DenigmaGap = {
      anchor: "P1.m1",
      position: { numerator: 1, denominator: 2 },
      extent: "complete",
      type: "chord-symbol",
      chord: {
        root: { step: "G", alteration: -1 },
        rootLowerCase: false,
        showRoot: true,
        showSuffix: true,
        suffix: {
          strings: [
            { text: "(", position: "inline" },
            { text: "add9", position: "above" },
            { text: "omit3)", position: "inline" },
          ],
          suffixText: "(add9omit3)",
          degrees: [
            { value: 9, alteration: 0, type: "add", impliedByText: false },
            { value: 3, alteration: 0, type: "remove", impliedByText: false },
          ],
          parenthesizeDegrees: true,
          stackDegrees: true,
          hasOuterParentheses: true,
          hasUnrecognizedGlyphs: false,
          quality: "major",
        },
      },
    };

    const result = apply([simple, rich]);
    const parsed = JSON.parse(result.mnxJson) as { global: { measures: JsonRecord[] } };
    expect(viritura(parsed.global.measures[0]!)["chordSymbols"]).toEqual([
      {
        position: { fraction: [0, 1] },
        root: { step: "C" },
        rawText: "Cmaj7",
        quality: "major",
        kindText: "maj7",
        extension: 7,
      },
      {
        position: { fraction: [1, 2] },
        root: { step: "G", alter: -1 },
        quality: "other",
        rawText: "Gb(add9omit3)",
        kindText: "(add9omit3)",
        textOverride: "Gb(add9omit3)",
      },
    ]);
    expect(result.outcomes.map((entry) => entry.disposition)).toEqual(["handled", "handled-partially"]);
  });

  it("preserves power-chord semantics and coalesces staff occurrences", () => {
    const powerChord = (staff: number): DenigmaGap => ({
      anchor: "P1.m1",
      staff,
      position: { numerator: 0, denominator: 1 },
      extent: "complete",
      type: "chord-symbol",
      chord: {
        root: { step: "A", alteration: 0 },
        rootLowerCase: false,
        showRoot: true,
        showSuffix: true,
        suffix: {
          strings: [{ text: "5", position: "inline" }],
          suffixText: "5",
          degrees: [],
          parenthesizeDegrees: false,
          stackDegrees: false,
          hasOuterParentheses: false,
          hasUnrecognizedGlyphs: false,
          quality: "power",
        },
      },
    });

    const result = apply([powerChord(1), powerChord(2)]);
    const parsed = JSON.parse(result.mnxJson) as { global: { measures: JsonRecord[] } };

    expect(viritura(parsed.global.measures[0]!)["chordSymbols"]).toEqual([
      {
        position: { fraction: [0, 1] },
        rawText: "A5",
        root: { step: "A" },
        quality: "power",
        kindText: "5",
      },
    ]);
    expect(result.outcomes.every((entry) => entry.disposition === "handled")).toBe(true);
  });

  it("rejects malformed nested chord payloads without throwing", () => {
    const result = apply([
      {
        anchor: "P1.m1",
        position: { numerator: 0, denominator: 1 },
        extent: "complete",
        type: "chord-symbol",
        chord: {
          root: { step: "C", alteration: 0 },
          rootLowerCase: false,
          showRoot: true,
          showSuffix: true,
          suffix: {
            strings: [null],
            suffixText: "7",
            degrees: [],
            parenthesizeDegrees: false,
            stackDegrees: false,
            hasOuterParentheses: false,
            hasUnrecognizedGlyphs: false,
            quality: "dominant",
          },
        },
      },
    ]);

    expect(result.outcomes[0]?.disposition).toBe("unhandled");
  });

  it("maps recognized per-note noteheads and leaves unsupported glyphs explicit", () => {
    const result = apply([
      {
        anchor: "ev1n1",
        extent: "complete",
        type: "notehead",
        notehead: { shape: "x", fill: "unspecified", glyph: "noteheadXBlack" },
      },
      {
        anchor: "ev2n1",
        extent: "complete",
        type: "notehead",
        notehead: { shape: "other", fill: "filled", glyph: "noteheadTriangleUpBlack" },
      },
      {
        anchor: "ev3n1",
        extent: "complete",
        type: "notehead",
        notehead: { shape: "other", fill: "unspecified", glyph: "noteheadSquareBlack" },
      },
      {
        anchor: "ev3n1",
        extent: "complete",
        type: "notehead",
        notehead: { shape: "other", fill: "filled", glyph: "noteheadDiamondClusterBlack2nd" },
      },
      {
        anchor: "ev3n1",
        extent: "complete",
        type: "notehead",
        notehead: { shape: "other", fill: "filled", glyph: "noteheadSlashX" },
      },
    ]);

    expect(viritura(noteAt(result.document, 0))["notehead"]).toBe("x");
    expect(viritura(noteAt(result.document, 1))["notehead"]).toBe("triangleUp");
    expect(noteAt(result.document, 2)["_x"]).toBeUndefined();
    expect(result.outcomes.map((entry) => entry.disposition)).toEqual([
      "handled",
      "handled-partially",
      "unhandled",
      "unhandled",
      "unhandled",
    ]);
  });

  it("decorates visible and playback-only standard tempo objects", () => {
    const visible: DenigmaGap = {
      anchor: "tempo-1",
      extent: "partial",
      type: "expression",
      expression: {
        type: "tempo-mark",
        scope: "top-staff",
        text: { plain: "Allegro" },
        tempo: { text: "Allegro", beatsPerMinute: 120, beatUnitEdu: 1024 },
      },
    };
    const hidden: DenigmaGap = {
      anchor: "tempo-1",
      extent: "partial",
      type: "playback-only",
    };

    const result = apply([visible, hidden]);
    const parsed = JSON.parse(result.mnxJson) as {
      global: { measures: Array<{ tempos: JsonRecord[] }> };
    };
    expect(viritura(parsed.global.measures[0]!.tempos[0]!)).toEqual({
      text: "Allegro",
      showMetronomeMark: false,
      showText: false,
    });
    expect(result.outcomes[1]?.disposition).toBe("handled");
  });

  it("hides the metronome mark for visible tempo text without a displayed metronome", () => {
    const result = apply([
      {
        anchor: "tempo-1",
        extent: "partial",
        type: "expression",
        expression: {
          type: "tempo-mark",
          scope: "top-staff",
          text: { plain: "Allegro", runs: [{ text: "Allegro" }] },
          tempo: { text: "Allegro", beatsPerMinute: 120, beatUnitEdu: 1024 },
        },
      },
    ]);
    const parsed = JSON.parse(result.mnxJson) as {
      global: { measures: Array<{ tempos: JsonRecord[] }> };
    };

    expect(viritura(parsed.global.measures[0]!.tempos[0]!)).toEqual({
      text: "Allegro",
      showMetronomeMark: false,
    });
  });

  it("keeps a visible metronome mark while extracting its prose prefix", () => {
    const result = apply([
      {
        anchor: "tempo-1",
        extent: "partial",
        type: "expression",
        expression: {
          type: "tempo-mark",
          scope: "top-staff",
          text: {
            plain: "Tempo (quarter=120)",
            runs: [
              { text: "Tempo (" },
              { text: "quarter", glyphs: ["metNoteQuarterUp"] },
              { text: "=" },
              { text: "120", insert: { kind: "playback-value", command: "value" } },
              { text: ")" },
            ],
          },
          tempo: { text: "Tempo (quarter=120)", beatsPerMinute: 120, beatUnitEdu: 1024 },
        },
      },
    ]);
    const parsed = JSON.parse(result.mnxJson) as {
      global: { measures: Array<{ tempos: JsonRecord[] }> };
    };

    expect(viritura(parsed.global.measures[0]!.tempos[0]!)).toEqual({ text: "Tempo" });
  });

  it("creates a standard tempo and preserves tempo-alteration text", () => {
    const result = apply([
      {
        anchor: "m1",
        position: { numerator: 0, denominator: 1 },
        extent: "complete",
        type: "expression",
        expression: {
          type: "tempo-mark",
          scope: "top-staff",
          tempo: { text: "Andante", beatsPerMinute: 96, beatUnitEdu: 1024 },
        },
      },
      {
        anchor: "m1",
        position: { numerator: 1, denominator: 4 },
        placements: [
          { kind: "system-top", anchor: "m1" },
          { kind: "staff", anchor: "P1.m1" },
        ],
        extent: "complete",
        type: "expression",
        expression: {
          type: "tempo-alteration",
          scope: "top-staff",
          text: { plain: "rit." },
          tempoAlteration: { text: "rit.", beatsPerMinute: 0, beatUnitEdu: 0 },
        },
      },
    ]);
    const parsed = JSON.parse(result.mnxJson) as {
      global: { measures: Array<{ tempos: JsonRecord[] }> };
      parts: Array<{ measures: JsonRecord[] }>;
    };

    expect(parsed.global.measures[0]!.tempos).toHaveLength(2);
    expect(parsed.global.measures[0]!.tempos[1]).toMatchObject({
      bpm: 96,
      value: { base: "quarter" },
      _x: { viritura: { text: "Andante", showMetronomeMark: false } },
    });
    expect(viritura(parsed.parts[0]!.measures[0]!)["expressions"]).toEqual([
      { text: "rit.", position: { fraction: [1, 4] }, placement: "above" },
    ]);
  });

  it("maps ordinary glissandos from note anchors to event anchors", () => {
    const result = apply([
      {
        anchor: "ev1n1",
        end: { anchor: "ev2n1" },
        extent: "complete",
        type: "smart-shape",
        smartShape: {
          shapeType: "glissando",
          kind: "glissando",
          glissando: {
            line: {
              lineStyle: "char",
              lineVisible: true,
              lineChar: { codePoint: 60079, glyph: "wiggleGlissando" },
              centerFullText: { plain: "gliss." },
            },
          },
        },
      },
    ]);
    expect(viritura(firstEvent(result.document))["glissandos"]).toEqual([
      { target: "ev2", kind: "glissando", style: "wavy", text: "gliss." },
    ]);
    expect(result.outcomes[0]?.disposition).toBe("handled-partially");
  });

  it("maps trill symbols and extension-only spans from rhythmic anchors", () => {
    const trill = (includesTrSymbol: boolean): DenigmaGap => ({
      anchor: "P1.m1",
      position: { numerator: 0, denominator: 1 },
      end: { anchor: "P1.m1", position: { numerator: 1, denominator: 2 } },
      extent: "complete",
      type: "smart-shape",
      smartShape: {
        shapeType: includesTrSymbol ? "trill" : "trill-extension",
        kind: "trill-line",
        trillLine: { includesTrSymbol },
      },
    });

    const withSymbol = apply([trill(true)]);
    const withSymbolMarkings = firstEvent(withSymbol.document)["markings"];
    expect(isRecord(withSymbolMarkings) ? viritura(withSymbolMarkings)["trill"] : undefined).toEqual({
      showSymbol: true,
      extension: { target: "ev2", targetEdge: "end" },
    });

    const extensionOnly = apply([trill(false)]);
    const extensionOnlyMarkings = firstEvent(extensionOnly.document)["markings"];
    expect(isRecord(extensionOnlyMarkings) ? viritura(extensionOnlyMarkings)["trill"] : undefined).toEqual({
      showSymbol: false,
      extension: { target: "ev2", targetEdge: "end" },
    });
  });

  it("preserves unknown gap types as explicit unhandled outcomes", () => {
    const result = apply([{ anchor: "m1", extent: "complete", type: "future-gap" }]);

    expect(result.outcomes[0]).toMatchObject({
      type: "future-gap",
      disposition: "unhandled",
    });
    expect(result.diagnostics[0]?.severity).toBe("warning");
  });

  it("leaves tab slides and malformed known payloads unhandled", () => {
    const result = apply([
      {
        anchor: "ev1n1",
        end: { anchor: "ev2n1" },
        extent: "complete",
        type: "smart-shape",
        smartShape: {
          shapeType: "tab-slide",
          kind: "glissando",
          glissando: { line: { lineStyle: "solid", lineVisible: true } },
        },
      },
      {
        anchor: "P1.m1",
        extent: "complete",
        type: "expression",
        expression: { type: "technique-text" },
      },
    ]);

    expect(result.outcomes.map((entry) => entry.disposition)).toEqual(["unhandled", "unhandled"]);
  });
});

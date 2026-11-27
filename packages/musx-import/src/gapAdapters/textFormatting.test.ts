import { describe, expect, it } from "vitest";
import type { DenigmaGap, DenigmaGapReport } from "../types";
import { applyDenigmaGapReport } from "./applyGapReport";
import type { JsonRecord } from "./types";

function formatting(offset: number, length: number, font: JsonRecord, anchor = "text0"): DenigmaGap {
  return {
    type: "text-formatting",
    extent: "partial",
    anchor: "expression",
    textRanges: [{ anchor, offset, length }],
    formatting: { font, baseline: 0, superscript: 0, tracking: 0 },
  };
}

function adapt(elements: JsonRecord[], gaps: DenigmaGap[]) {
  const source = {
    mnx: { version: 52 },
    global: { measures: [{}] },
    parts: [
      {
        measures: [
          {
            text: [
              {
                id: "expression",
                type: "expression",
                position: { fraction: [1, 4], graceIndex: -1 },
                voice: "2",
                text: elements,
              },
            ],
            sequences: [
              {
                content: [
                  {
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 }, notehead: { shape: "square" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const report: DenigmaGapReport = {
    schemaVersion: 2,
    producer: { name: "denigma", version: "4.0.0", commit: "66e154a5" },
    gaps,
  };
  const result = applyDenigmaGapReport(JSON.stringify(source), report);
  const document = JSON.parse(result.mnxJson) as typeof source;
  return { ...result, measure: document.parts[0]!.measures[0]!, source };
}

describe("schema-v2 text formatting", () => {
  it("applies separate ranges in one gap to the same original element", () => {
    const gap = formatting(0, 1, { bold: true });
    gap.textRanges!.push({ anchor: "text0", offset: 2, length: 1 });
    const result = adapt([{ id: "text0", text: "ABC" }], [gap]);
    expect(result.measure.text[0]!.text).toEqual([
      { id: "text0", text: "A", _x: { viritura: { style: { weight: "bold" } } } },
      { text: "B" },
      { text: "C", _x: { viritura: { style: { weight: "bold" } } } },
    ]);
  });

  it("splits Unicode scalar ranges while keeping original coordinates across overlapping gaps", () => {
    const result = adapt(
      [{ id: "text0", text: "A😀BC" }],
      [formatting(1, 2, { italic: true }), formatting(2, 2, { bold: true })],
    );
    expect(result.measure.text[0]!.text).toEqual([
      { id: "text0", text: "A" },
      { text: "😀", _x: { viritura: { style: { fontStyle: "italic" } } } },
      { text: "B", _x: { viritura: { style: { fontStyle: "italic", weight: "bold" } } } },
      { text: "C", _x: { viritura: { style: { weight: "bold" } } } },
    ]);
    expect(result.outcomes.map((entry) => entry.disposition)).toEqual(["handled", "handled"]);
  });

  it("counts glyph-list entries and retains authored extensions", () => {
    const result = adapt(
      [
        {
          id: "text0",
          type: "smufl",
          glyphs: ["metNoteQuarterUp", "metAugmentationDot"],
          _x: { viritura: { smuflStyle: "large" } },
        },
      ],
      [formatting(1, 1, { underline: true, strikeout: true, name: "Maestro", size: 12 })],
    );
    expect(result.measure.text[0]!.text).toEqual([
      { id: "text0", type: "smufl", glyphs: ["metNoteQuarterUp"], _x: { viritura: { smuflStyle: "large" } } },
      {
        type: "smufl",
        glyphs: ["metAugmentationDot"],
        _x: { viritura: { smuflStyle: "large", style: { decorations: ["underline", "strikethrough"] } } },
      },
    ]);
    expect(result.outcomes[0]?.disposition).toBe("handled-partially");
  });

  it.each([
    formatting(0, 5, { bold: true }),
    formatting(-1, 1, { bold: true }),
    formatting(0.5, 1, { bold: true }),
    formatting(0, 0, { bold: true }),
    formatting(0, 1, { bold: true }, "missing"),
    { ...formatting(0, 1, { bold: true }), anchor: "missing" },
  ])("reports invalid ranges without changing existing text", (gap) => {
    const result = adapt([{ id: "text0", text: "ABC" }], [gap]);
    expect(result.measure.text).toEqual(result.source.parts[0]!.measures[0]!.text);
    expect(result.outcomes[0]?.disposition).toBe("unhandled");
  });

  it("keeps native text positioning and noteheads without duplicating partial technique expressions", () => {
    const result = adapt(
      [{ id: "text0", text: "pizz." }],
      [
        formatting(0, 5, { italic: true }),
        {
          type: "expression",
          extent: "partial",
          anchor: "expression",
          expression: { type: "technique-text", technique: { type: "pizzicato", text: "pizz." } },
        },
      ],
    );
    expect(result.measure.text).toHaveLength(1);
    expect(result.measure.text[0]).toMatchObject({ voice: "2", position: { fraction: [1, 4], graceIndex: -1 } });
    expect(result.measure.sequences).toEqual(result.source.parts[0]!.measures[0]!.sequences);
    expect(result.outcomes[1]?.disposition).toBe("handled-partially");
  });

  it("preserves substituted text and reports unsupported insert semantics", () => {
    const result = adapt(
      [{ id: "text0", text: "2" }],
      [
        {
          type: "text-insert",
          extent: "partial",
          anchor: "expression",
          textRanges: [{ anchor: "text0", offset: 0, length: 1 }],
          insert: { kind: "playback-pass", command: "pass", parameters: [], sourceText: "^pass()" },
        },
      ],
    );
    expect(result.measure.text[0]!.text).toEqual([{ id: "text0", text: "2" }]);
    expect(result.outcomes[0]?.disposition).toBe("unhandled");
  });
});

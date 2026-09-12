import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { applyChordSymbolEdit } from "../app/popoverHandlers";
import { resolveChordSymbolTarget } from "../app/useAppKeyboardWiring";

function scoreWithQuarterNotes(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        staves: 2,
        measures: [
          {
            sequences: [
              {
                staff: 2,
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("applyChordSymbolEdit", () => {
  it("uses a selected notehead as the harmony-lane onset anchor", () => {
    const target = resolveChordSymbolTarget(
      scoreWithQuarterNotes(),
      { kind: "single", elementId: "p0/m0/s0/e1/n0", elementType: "note" },
      0,
      { x: 120, y: 80 },
    );

    expect(target).toEqual({
      position: { x: 120, y: 80 },
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 1,
      anchorStaff: 2,
    });
  });

  it("creates a part-level harmony event without inheriting the selected note's staff", () => {
    const updated = applyChordSymbolEdit(
      scoreWithQuarterNotes(),
      {
        position: { x: 0, y: 0 },
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 1,
      },
      "F#maj7/A#",
    );

    expect(updated?.parts[0]!.measures[0]!.chordSymbols).toEqual([
      {
        position: { fraction: [1, 4] },
        root: { step: "F", alter: 1 },
        quality: "major",
        extension: 7,
        bass: { step: "A", alter: 1 },
      },
    ]);
  });

  it("replaces an event at the same lane position instead of attaching another to the note", () => {
    const score = scoreWithQuarterNotes();
    const target = {
      position: { x: 0, y: 0 },
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };
    const first = applyChordSymbolEdit(score, target, "C");
    const replaced = first ? applyChordSymbolEdit(first, target, "Dm7") : undefined;

    expect(replaced?.parts[0]!.measures[0]!.chordSymbols).toEqual([
      {
        position: { fraction: [0, 1] },
        root: { step: "D" },
        quality: "minor",
        extension: 7,
      },
    ]);
  });

  it("replaces an imported staff-targeted chord while preserving its display override", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.measures[0]!.chordSymbols = [
      {
        position: { fraction: [0, 1] },
        displayStaff: 2,
        root: { step: "C" },
        quality: "major",
      },
      {
        position: { fraction: [0, 1] },
        displayStaff: 1,
        root: { step: "G" },
        quality: "dominant",
        extension: 7,
      },
    ];

    const updated = applyChordSymbolEdit(
      score,
      {
        position: { x: 0, y: 0 },
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
        anchorStaff: 2,
      },
      "Dm7",
    );

    expect(updated?.parts[0]!.measures[0]!.chordSymbols).toEqual([
      {
        position: { fraction: [0, 1] },
        displayStaff: 2,
        root: { step: "D" },
        quality: "minor",
        extension: 7,
      },
      {
        position: { fraction: [0, 1] },
        displayStaff: 1,
        root: { step: "G" },
        quality: "dominant",
        extension: 7,
      },
    ]);
  });

  it("rejects unsupported input without mutating the score", () => {
    expect(
      applyChordSymbolEdit(
        scoreWithQuarterNotes(),
        { position: { x: 0, y: 0 }, partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
        "not a chord",
      ),
    ).toBeUndefined();
  });

  it("anchors a chord to the performed position inside a tuplet", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", duration: { base: "quarter" }, rest: {} },
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content: [
          { type: "event", duration: { base: "eighth" }, rest: {} },
          { type: "event", duration: { base: "eighth" }, rest: {} },
          { type: "event", duration: { base: "eighth" }, rest: {} },
        ],
      },
    ];

    const updated = applyChordSymbolEdit(
      score,
      {
        position: { x: 0, y: 0 },
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        tupletIndex: 1,
        eventIndex: 1,
      },
      "G7",
    );

    expect(updated?.parts[0]!.measures[0]!.chordSymbols?.[0]?.position).toEqual({ fraction: [1, 3] });
  });
});

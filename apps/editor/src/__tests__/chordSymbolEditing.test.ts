import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { applyChordSymbolEdit } from "../app/popoverHandlers";
import { resolveChordSymbolTarget } from "../app/useAppKeyboardWiring";
import { navigateChordSymbolInput } from "../app/chordSymbolNavigation";

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
      anchorElementId: "p0/m0/s0/e1",
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

  it("uses a direct beat-stepping position instead of the anchor event onset", () => {
    const updated = applyChordSymbolEdit(
      scoreWithQuarterNotes(),
      {
        position: { x: 0, y: 0 },
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
        rhythmicPosition: { fraction: [3, 4] },
      },
      "G7",
    );

    expect(updated?.parts[0]!.measures[0]!.chordSymbols?.[0]?.position).toEqual({ fraction: [3, 4] });
  });

  it("navigates continuously to the next event and next measure", () => {
    const score = scoreWithQuarterNotes();
    const firstMeasureContent = score.parts[0]!.measures[0]!.sequences[0]!.content;
    if (firstMeasureContent[0]?.type === "event") firstMeasureContent[0].id = "nav-0";
    if (firstMeasureContent[1]?.type === "event") firstMeasureContent[1].id = "nav-1";
    score.parts[0]!.measures.push({
      sequences: [
        {
          staff: 2,
          content: [{ type: "event", id: "nav-2", duration: { base: "whole" }, rest: {} }],
        },
      ],
    });
    const current = resolveChordSymbolTarget(
      score,
      { kind: "single", elementId: "p0/m0/s0/nav-0/n0", elementType: "note" },
      0,
      { x: 100, y: 80 },
    )!;

    const next = navigateChordSymbolInput(score, current, "next", 0);
    const nextMeasure = navigateChordSymbolInput(score, next!, "nextMeasure", 0);

    expect(next).toMatchObject({ measureIndex: 0, eventIndex: 1, anchorElementId: "p0/m0/s0/nav-1" });
    expect(nextMeasure).toMatchObject({ measureIndex: 1, eventIndex: 0, anchorElementId: "p0/m1/s0/nav-2" });
  });

  it("steps by the active meter unit and crosses barlines", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.measures.push({
      sequences: [{ staff: 2, content: [{ type: "event", id: "beat-next", duration: { base: "whole" }, rest: {} }] }],
    });
    const first = score.parts[0]!.measures[0]!.sequences[0]!.content[0];
    if (first?.type === "event") first.id = "beat-current";
    const current = resolveChordSymbolTarget(
      score,
      { kind: "single", elementId: "p0/m0/s0/beat-current/n0", elementType: "note" },
      0,
      { x: 100, y: 80 },
    )!;

    const beatTwo = navigateChordSymbolInput(score, current, "nextBeat", 0);
    const finalBeat = navigateChordSymbolInput(
      score,
      { ...beatTwo!, rhythmicPosition: { fraction: [3, 4] } },
      "nextBeat",
      0,
    );
    const previousBeat = navigateChordSymbolInput(score, finalBeat!, "previousBeat", 0);

    expect(beatTwo?.rhythmicPosition).toEqual({ fraction: [1, 4] });
    expect(beatTwo).toMatchObject({ eventIndex: 1 });
    expect(beatTwo?.anchorElementId).not.toBe(current.anchorElementId);
    expect(finalBeat).toMatchObject({ measureIndex: 1, rhythmicPosition: { fraction: [0, 1] } });
    expect(previousBeat).toMatchObject({ measureIndex: 0, rhythmicPosition: { fraction: [1, 4] } });
  });

  it("uses compound-meter beats and includes full-measure rests in navigation", () => {
    const score = scoreWithQuarterNotes();
    score.global.measures[0]!.time = { count: 6, unit: 8 };
    score.global.measures.push({});
    score.parts[0]!.measures.push({
      sequences: [{ staff: 2, content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
    });
    const first = score.parts[0]!.measures[0]!.sequences[0]!.content[0];
    if (first?.type === "event") first.id = "compound-start";
    const current = resolveChordSymbolTarget(
      score,
      { kind: "single", elementId: "p0/m0/s0/compound-start/n0", elementType: "note" },
      0,
      { x: 100, y: 80 },
    )!;

    const nextBeat = navigateChordSymbolInput(score, current, "nextBeat", 0);
    const nextMeasure = navigateChordSymbolInput(score, current, "nextMeasure", 0);

    expect(nextBeat?.rhythmicPosition).toEqual({ fraction: [3, 8] });
    expect(nextMeasure).toMatchObject({ measureIndex: 1, eventIndex: 0 });
    expect(nextMeasure?.anchorElementId).toBeTruthy();
  });
});

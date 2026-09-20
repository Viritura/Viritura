import { describe, expect, it } from "vitest";
import { parseChordSymbolText, resolveChordSymbol, type Score } from "@viritura/core";
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

  it("creates a global harmony event using the selected note as its time anchor", () => {
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

    expect(updated?.global.measures[0]!.chordSymbols).toEqual([
      {
        position: { fraction: [1, 4] },
        root: { step: "F", alter: 1 },
        quality: "major",
        rawText: "F#maj7/A#",
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

    expect(replaced?.global.measures[0]!.chordSymbols).toEqual([
      {
        position: { fraction: [0, 1] },
        root: { step: "D" },
        quality: "minor",
        rawText: "Dm7",
        extension: 7,
      },
    ]);
  });

  it("atomically shows newly entered global harmony on the source part, without changing layouts", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.id = "piano";
    score.layouts = [
      {
        id: "full",
        content: [
          {
            type: "group",
            content: [
              { type: "staff", sources: [{ part: "piano", staff: 1 }] },
              { type: "staff", sources: [{ part: "piano", staff: 2 }] },
            ],
          },
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
        eventIndex: 0,
        anchorStaff: 2,
      },
      "C",
    );
    expect(updated?.layouts).toBe(score.layouts);
    expect(updated?.parts[0]?.chordSymbolVisibility).toBe("show");
    expect(score.parts[0]?.chordSymbolVisibility).toBeUndefined();
  });

  it("upserts all equivalent rational onsets and preserves unrelated harmony", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.chordSymbolVisibility = "hide";
    const later = parseChordSymbolText("G7", { fraction: [3, 4] });
    score.global.measures[0]!.chordSymbols = [
      parseChordSymbolText("C", { fraction: [1, 4] }),
      parseChordSymbolText("F", { fraction: [2, 8] }),
      later,
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
        rhythmicPosition: { fraction: [3, 12] },
      },
      "Dm7",
    );

    expect(updated?.global.measures[0]!.chordSymbols).toEqual([
      parseChordSymbolText("Dm7", { fraction: [3, 12] }),
      later,
    ]);
    expect(updated?.global.measures[0]?.chordSymbols?.[1]).toBe(later);
    expect(updated?.parts[0]?.chordSymbolVisibility).toBe("show");
    expect(updated?.parts[0]?.measures).toBe(score.parts[0]?.measures);
    expect(score.parts[0]?.chordSymbolVisibility).toBe("hide");
    expect(score.global.measures[0]?.chordSymbols).toHaveLength(3);
  });

  it("commits unsupported authored text without guessing major harmony", () => {
    const updated = applyChordSymbolEdit(
      scoreWithQuarterNotes(),
      { position: { x: 0, y: 0 }, partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 },
      "not a chord",
    );
    const chord = updated?.global.measures[0]?.chordSymbols?.[0];
    expect(chord).toEqual({ rawText: "not a chord", position: { fraction: [0, 1] } });
    expect(resolveChordSymbol(chord!)).toEqual({
      status: "unsupported",
      message: "Unsupported chord: cannot play this symbol.",
    });
  });

  it.each([undefined, "auto", "hide"] as const)("overrides %s source visibility in the same update", (visibility) => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.chordSymbolVisibility = visibility;
    const next = applyChordSymbolEdit(
      score,
      {
        position: { x: 0, y: 0 },
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
      },
      "C",
    );
    expect(next?.parts[0]?.chordSymbolVisibility).toBe("show");
    expect(next?.global.measures[0]?.chordSymbols).toHaveLength(1);
    expect(score.parts[0]?.chordSymbolVisibility).toBe(visibility);
    expect(score.global.measures[0]?.chordSymbols).toBeUndefined();
  });

  it("rejects empty input and invalid destinations without partial visibility changes", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.chordSymbolVisibility = "hide";
    const target = { position: { x: 0, y: 0 }, partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 };
    expect(applyChordSymbolEdit(score, target, "   ")).toBeUndefined();
    score.global.measures = [];
    expect(applyChordSymbolEdit(score, target, "C")).toBeUndefined();
    expect(score.parts[0]?.chordSymbolVisibility).toBe("hide");
  });

  it("stores written C/E on a B-flat instrument as concert Bb/D", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.transposition = { interval: { halfSteps: 2, staffDistance: 1 } };
    score.scores = [{ name: "Concert" }, { name: "Written", useWritten: true }];
    const target = { position: { x: 0, y: 0 }, partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 };
    const concert = applyChordSymbolEdit(score, target, "C/E", 0);
    const written = applyChordSymbolEdit(score, target, "C/E", 1);
    expect(concert?.global.measures[0]?.chordSymbols?.[0]).toMatchObject({
      root: { step: "C" },
      bass: { step: "E" },
      rawText: "C/E",
    });
    expect(written?.global.measures[0]?.chordSymbols?.[0]).toMatchObject({
      root: { step: "B", alter: -1 },
      bass: { step: "D" },
      rawText: "Bb/D",
    });
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

    expect(updated?.global.measures[0]!.chordSymbols?.[0]?.position).toEqual({ fraction: [1, 3] });
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

    expect(updated?.global.measures[0]!.chordSymbols?.[0]?.position).toEqual({ fraction: [3, 4] });
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
    expect(previousBeat).toMatchObject({ measureIndex: 0, rhythmicPosition: { fraction: [3, 4] } });
  });

  it("navigates every beat of an underfilled 4/4 measure in both directions", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", id: "only-quarter", duration: { base: "quarter" }, rest: {} },
    ];
    score.global.measures.push({});
    score.parts[0]!.measures.push({ sequences: [{ staff: 2, content: [], fullMeasure: {} }] });
    const start = resolveChordSymbolTarget(
      score,
      { kind: "single", elementId: "p0/m0/s0/only-quarter", elementType: "rest" },
      0,
      { x: 0, y: 0 },
    )!;
    let current = start;
    for (const fraction of [
      [1, 4],
      [1, 2],
      [3, 4],
    ]) {
      current = navigateChordSymbolInput(score, current, "nextBeat", 0)!;
      expect(current).toMatchObject({
        measureIndex: 0,
        anchorElementId: start.anchorElementId,
        rhythmicPosition: { fraction },
      });
    }
    current = navigateChordSymbolInput(score, current, "nextBeat", 0)!;
    expect(current).toMatchObject({ measureIndex: 1, rhythmicPosition: { fraction: [0, 1] } });
    for (const fraction of [
      [3, 4],
      [1, 2],
      [1, 4],
      [0, 1],
    ]) {
      current = navigateChordSymbolInput(score, current, "previousBeat", 0)!;
      expect(current).toMatchObject({ measureIndex: 0, rhythmicPosition: { fraction } });
    }
    expect(navigateChordSymbolInput(score, current, "previousBeat", 0)).toBeNull();
  });

  it.each([undefined, { count: 3, unit: 4 }, { count: 6, unit: 8 }])(
    "uses inherited/default meter %j rather than overfull or underfull content",
    (time) => {
      const score = scoreWithQuarterNotes();
      score.global.measures = [{ time }, { number: 0 }, {}];
      score.parts[0]!.measures = Array.from({ length: 3 }, (_, index) => ({
        sequences: [
          {
            staff: 2,
            content: [{ type: "event", id: `meter-${index}`, duration: { base: "whole" }, rest: {} }],
          },
        ],
      }));
      const current = resolveChordSymbolTarget(
        score,
        { kind: "single", elementId: "p0/m1/s0/meter-1", elementType: "rest" },
        0,
        { x: 0, y: 0 },
      )!;
      const last =
        time?.unit === 8
          ? ([3, 8] as [number, number])
          : time
            ? ([1, 2] as [number, number])
            : ([3, 4] as [number, number]);
      const next = navigateChordSymbolInput(
        score,
        { ...current, rhythmicPosition: { fraction: last } },
        "nextBeat",
        0,
      )!;
      expect(next).toMatchObject({ measureIndex: 2, rhythmicPosition: { fraction: [0, 1] } });
      expect(navigateChordSymbolInput(score, next, "previousBeat", 0)).toMatchObject({
        measureIndex: 1,
        rhythmicPosition: { fraction: last },
      });
    },
  );

  it.each(["quarter", "half", "eighth"] as const)(
    "uses the score-wide %s pickup duration, ignoring full-measure placeholders",
    (base) => {
      const score = scoreWithQuarterNotes();
      score.global.measures[0]!.number = 0;
      score.global.measures.push({});
      score.parts[0]!.measures = Array.from({ length: 2 }, () => ({
        sequences: [{ staff: 2, content: [], fullMeasure: {} }],
      }));
      score.parts.push({
        measures: [
          {
            sequences: [{ content: [{ type: "event", id: "pickup", duration: { base }, rest: {} }] }],
          },
        ],
      });
      const start = resolveChordSymbolTarget(
        score,
        { kind: "single", elementId: "p0/m0/s0/__auto_m0_v0_e0", elementType: "rest" },
        0,
        { x: 0, y: 0 },
      )!;
      const next = navigateChordSymbolInput(score, start, "nextBeat", 0)!;
      const nextMeasure = base === "half" ? navigateChordSymbolInput(score, next, "nextBeat", 0)! : next;
      if (base === "half") expect(next).toMatchObject({ measureIndex: 0, rhythmicPosition: { fraction: [1, 4] } });
      expect(nextMeasure).toMatchObject({ measureIndex: 1, rhythmicPosition: { fraction: [0, 1] } });
      expect(navigateChordSymbolInput(score, nextMeasure, "previousBeat", 0)).toMatchObject({
        measureIndex: 0,
        rhythmicPosition: { fraction: base === "half" ? [1, 4] : [0, 1] },
      });
    },
  );

  it("uses nominal duration for an empty pickup and longest written duration only for the declaring cadenza", () => {
    const score = scoreWithQuarterNotes();
    score.global.measures = [
      { number: 0, time: { count: 4, unit: 4 } },
      { time: { count: 4, unit: 4, display: "senzaMisura" } },
      {},
      {},
    ];
    score.parts[0]!.measures = Array.from({ length: 4 }, () => ({
      sequences: [{ staff: 2, content: [], fullMeasure: {} }],
    }));
    score.parts.push({
      measures: Array.from({ length: 4 }, (_, index) => ({
        sequences: [
          {
            content: index === 0 ? [] : [{ type: "event", id: `long-${index}`, duration: { base: "breve" }, rest: {} }],
          },
        ],
      })),
    });
    const start = resolveChordSymbolTarget(
      score,
      { kind: "single", elementId: "p0/m0/s0/__auto_m0_v0_e0", elementType: "rest" },
      0,
      { x: 0, y: 0 },
    )!;
    expect(navigateChordSymbolInput(score, start, "nextBeat", 0)).toMatchObject({
      measureIndex: 0,
      rhythmicPosition: { fraction: [1, 4] },
    });
    const cadenza = navigateChordSymbolInput(score, start, "nextMeasure", 0)!;
    expect(
      navigateChordSymbolInput(score, { ...cadenza, rhythmicPosition: { fraction: [3, 4] } }, "nextBeat", 0),
    ).toMatchObject({ measureIndex: 1, rhythmicPosition: { fraction: [1, 1] } });
    const following = navigateChordSymbolInput(
      score,
      { ...cadenza, rhythmicPosition: { fraction: [7, 4] } },
      "nextBeat",
      0,
    )!;
    expect(following).toMatchObject({ measureIndex: 2, rhythmicPosition: { fraction: [0, 1] } });
    expect(navigateChordSymbolInput(score, following, "previousBeat", 0)).toMatchObject({
      measureIndex: 1,
      rhythmicPosition: { fraction: [7, 4] },
    });
    expect(
      navigateChordSymbolInput(score, { ...following, rhythmicPosition: { fraction: [3, 4] } }, "nextBeat", 0),
    ).toMatchObject({ measureIndex: 3, rhythmicPosition: { fraction: [0, 1] } });
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

  it("uses the longest voice when beat-stepping through a polyphonic measure", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.measures[0]!.sequences.push({
      staff: 2,
      content: [{ type: "event", id: "sustained", duration: { base: "whole" }, rest: {} }],
    });
    const first = score.parts[0]!.measures[0]!.sequences[0]!.content[0];
    if (first?.type === "event") first.id = "short-voice";
    const current = resolveChordSymbolTarget(
      score,
      { kind: "single", elementId: "p0/m0/s0/short-voice/n0", elementType: "note" },
      0,
      { x: 100, y: 80 },
    )!;

    const nextBeat = navigateChordSymbolInput(
      score,
      { ...current, rhythmicPosition: { fraction: [1, 4] } },
      "nextBeat",
      0,
    );

    expect(nextBeat).toMatchObject({ measureIndex: 0, rhythmicPosition: { fraction: [1, 2] } });
  });

  it("enters and beat-navigates a full-measure rest without materializing notes", () => {
    const score = scoreWithQuarterNotes();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [];
    sequence.fullMeasure = { visualDuration: { base: "whole" } };
    const current = resolveChordSymbolTarget(
      score,
      {
        kind: "single",
        elementId: "p0/m0/s0/e0",
        elementType: "rest",
      },
      0,
      { x: 10, y: 20 },
    )!;
    expect(current).toMatchObject({ partIndex: 0, sequenceIndex: 0, eventIndex: 0 });
    const next = navigateChordSymbolInput(score, current, "nextBeat", 0)!;
    expect(next.rhythmicPosition).toEqual({ fraction: [1, 4] });
    const edited = applyChordSymbolEdit(score, next, "NC")!;
    expect(edited.parts[0]?.measures[0]?.sequences[0]).toBe(sequence);
    expect(edited.global.measures[0]?.chordSymbols?.[0]).toEqual({
      position: { fraction: [1, 4] },
      rawText: "NC",
    });
  });

  it("targets full measure selections on their source staff", () => {
    const score = scoreWithQuarterNotes();
    const current = resolveChordSymbolTarget(
      score,
      {
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 1,
        endStaffIndex: 1,
        startLocalStaffIndex: 1,
        endLocalStaffIndex: 1,
        startMeasure: 0,
        endMeasure: 0,
      },
      0,
      { x: 10, y: 20 },
    );
    expect(current).toMatchObject({
      partIndex: 0,
      sequenceIndex: 0,
      anchorStaff: 2,
      rhythmicPosition: { fraction: [0, 1] },
    });
  });

  it.each(["m0/chord0", "m0/chord0/p0/staff2"])("edits canonical harmony from %s", (elementId) => {
    const score = scoreWithQuarterNotes();
    score.global.measures[0]!.chordSymbols = [
      parseChordSymbolText("C", { fraction: [2, 8] }),
      parseChordSymbolText("G", { fraction: [3, 4] }),
    ];
    const current = resolveChordSymbolTarget(
      score,
      {
        kind: "single",
        elementId,
        elementType: "chord-symbol",
        measureAnchor: { partIndex: 0, measureIndex: 0, staffIndex: 1, localStaffIndex: 1 },
      },
      0,
      { x: 10, y: 20 },
    )!;
    expect(current.rhythmicPosition).toEqual({ fraction: [2, 8] });
    const updated = applyChordSymbolEdit(score, current, "Dm/F")!;
    expect(updated.global.measures[0]?.chordSymbols?.map((chord) => chord.rawText)).toEqual(["Dm/F", "G"]);
    expect(updated.parts[0]?.measures).toBe(score.parts[0]?.measures);
  });

  it("uses the active part layout to resolve a canonical global chord", () => {
    const score = scoreWithQuarterNotes();
    score.parts[0]!.id = "first";
    score.parts.push({ id: "second", measures: [{ sequences: [{ content: [], fullMeasure: {} }] }] });
    score.layouts = [{ id: "second-only", content: [{ type: "staff", sources: [{ part: "second" }] }] }];
    score.scores = [{ name: "Part", layout: "second-only", useWritten: true }];
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C", { fraction: [0, 1] })];
    expect(
      resolveChordSymbolTarget(
        score,
        {
          kind: "single",
          elementId: "m0/chord0",
          elementType: "chord-symbol",
        },
        0,
        { x: 0, y: 0 },
      ),
    ).toMatchObject({ partIndex: 1, anchorStaff: 1 });
  });
});

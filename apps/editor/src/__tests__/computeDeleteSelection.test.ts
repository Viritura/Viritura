import { describe, it, expect } from "vitest";
import type { Score, NoteEvent, Step, Octave } from "@viritura/core";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { toggleDynamic } from "../commands/articulationCommands";
import type { Selection } from "../store/selectionStore";

function note(id: string, step: Step = "C", octave: Octave = 4): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}

function chord(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [
      { pitch: { step: "C", octave: 4 } },
      { pitch: { step: "E", octave: 4 } },
      { pitch: { step: "G", octave: 4 } },
    ],
  };
}

// [ev0 (chord), ev1, ev2, ev3] in one sequence so we can delete non-adjacent
// events without triggering adjacent-rest merges.
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        name: "Violin",
        measures: [{ sequences: [{ content: [chord("ev0"), note("ev1", "D"), note("ev2", "E"), note("ev3", "F")] }] }],
      },
    ],
  };
}

function contentAt(score: Score, i: number): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[i] as NoteEvent;
}

describe("computeDeleteSelection (migrated to resolveSelectionEvents)", () => {
  it.each(["m0/chord0", "m0/chord0/p0/staff1"])(
    "deletes global harmony from %s without deleting music",
    (elementId) => {
      const score = makeScore();
      score.global.measures[0]!.chordSymbols = [
        { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
      ];
      const original = structuredClone(score);
      const result = computeDeleteSelection(score, { kind: "single", elementId, elementType: "chord-symbol" });
      expect(result.kind).toBe("single");
      if (result.kind !== "single") return;
      expect(result.score.global.measures[0]!.chordSymbols).toBeUndefined();
      expect(result.score.parts).toEqual(original.parts);
      expect(score).toEqual(original);
      expect(result.nextSelection).toEqual({ kind: "clear" });
    },
  );

  it("deduplicates roots and rendered copies before deleting global chords in descending order", () => {
    const score = makeScore();
    score.global.measures[0]!.chordSymbols = [
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
      { position: { fraction: [1, 4] }, root: { step: "D" }, quality: "minor" },
      { position: { fraction: [1, 2] }, root: { step: "E" }, quality: "minor" },
    ];
    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["m0/chord0", "m0/chord0/p0/staff1", "m0/chord0/p1/staff2", "m0/chord1/p0/staff1"],
    });
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    expect(result.score.global.measures[0]!.chordSymbols?.map((symbol) => symbol.root.step)).toEqual(["E"]);
    expect(result.score.parts).toEqual(score.parts);
    expect(score.global.measures[0]!.chordSymbols).toHaveLength(3);
  });

  it("deletes mixed chord-copy and event selections", () => {
    const score = makeScore();
    score.global.measures[0]!.chordSymbols = [
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ];
    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["m0/chord0/p0/staff1", "p0/m0/s0/ev1"],
    });
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    expect(result.score.global.measures[0]!.chordSymbols).toBeUndefined();
    expect(contentAt(result.score, 1).rest).toBeDefined();
    expect(contentAt(result.score, 0).notes).toHaveLength(3);
  });

  it.each([false, true])("collapses a bar and removes only selected global harmony (selected=%s)", (selectChord) => {
    const score = makeScore();
    const chordSymbols = [{ position: { fraction: [0, 1] as [number, number] }, root: { step: "C" as const } }];
    score.global.measures[0]!.chordSymbols = chordSymbols;
    toggleDynamic(score, 0, 0, 0, 0, "f");

    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: [
        "p0/m0/s0/ev0",
        "p0/m0/s0/ev1",
        "p0/m0/s0/ev2",
        "p0/m0/s0/ev3",
        ...(selectChord ? ["m0/chord0", "m0/chord0/p0/staff1"] : []),
      ],
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    const sequence = result.score.parts[0]!.measures[0]!.sequences[0]!;
    expect(sequence.content).toEqual([]);
    expect(sequence.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
    expect(result.score.parts[0]!.measures[0]!.dynamics).toBeUndefined();
    expect(result.score.global.measures[0]!.chordSymbols).toEqual(selectChord ? undefined : chordSymbols);
  });

  it.each(["p0/m0/chord0", "m0/chord4/p0/staff1", "m0/chord0junk", "m0/chord", "m0/chord0/p0/staff1/extra"])(
    "ignores invalid or removed chord paths: %s",
    (elementId) => {
      const score = makeScore();
      score.global.measures[0]!.chordSymbols = [
        { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
      ];
      expect(computeDeleteSelection(score, { kind: "single", elementId, elementType: "chord-symbol" })).toEqual({
        kind: "noop",
      });
      expect(score.global.measures[0]!.chordSymbols).toHaveLength(1);
    },
  );

  it("deletes a selected glissando without deleting its notes", () => {
    const score = makeScore();
    contentAt(score, 0).glissandos = [{ target: "ev1", kind: "portamento", text: "port." }];

    const result = computeDeleteSelection(score, {
      kind: "single",
      elementId: "gliss/ev0/ev1",
      elementType: "glissando",
    });

    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(contentAt(result.score, 0).glissandos).toBeUndefined();
    expect(contentAt(result.score, 0).notes).toHaveLength(3);
    expect(contentAt(result.score, 1).notes).toHaveLength(1);
  });

  it("removes only the selected noteheads when part of a chord is selected", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0/n0", "p0/m0/s0/ev0/n2"] };
    const result = computeDeleteSelection(makeScore(), sel);
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    // C and G go; E keeps the chord alive, so ev0 is still a note.
    expect(contentAt(result.score, 0).rest).toBeUndefined();
    expect(contentAt(result.score, 0).notes!.map((n) => n.pitch.step)).toEqual(["E"]);
    expect(contentAt(result.score, 1).notes).toBeDefined();
  });

  it("blanks the chord once every one of its noteheads is selected", () => {
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/s0/ev0/n0", "p0/m0/s0/ev0/n1", "p0/m0/s0/ev0/n2"],
    };
    const result = computeDeleteSelection(makeScore(), sel);
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    expect(contentAt(result.score, 0).rest).toBeDefined();
    expect(contentAt(result.score, 0).notes).toBeUndefined();
    expect(contentAt(result.score, 1).notes).toBeDefined();
  });

  it("deletes every distinct event of a multi selection", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0", "p0/m0/s0/ev2"] };
    const result = computeDeleteSelection(makeScore(), sel);
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    expect(contentAt(result.score, 0).rest).toBeDefined();
    expect(contentAt(result.score, 1).notes).toBeDefined(); // ev1 untouched
    expect(contentAt(result.score, 2).rest).toBeDefined();
  });

  it("deletes both selected notes inside a multi-note tremolo", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tremolo",
        marks: 2,
        outer: { duration: { base: "quarter" }, multiple: 2 },
        individualDuration: { base: "quarter" },
        content: [
          { ...note("trem-a"), duration: { base: "half" } },
          { ...note("trem-b", "E"), duration: { base: "half" } },
        ],
      },
    ];
    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/trem-a", "p0/m0/s0/trem-b"],
    });
    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    const content = result.score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content.every((event) => event.type === "event" && event.rest !== undefined)).toBe(true);
  });

  it("collapses a fully deleted bar containing a tuplet to a full-measure rest", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        outer: { duration: { base: "eighth" }, multiple: 2 },
        inner: { duration: { base: "eighth" }, multiple: 3 },
        content: [
          { ...note("triplet-a"), duration: { base: "eighth" } },
          { ...note("triplet-b", "D"), duration: { base: "eighth" } },
          { ...note("triplet-c", "E"), duration: { base: "eighth" } },
        ],
      },
      note("beat-two", "F"),
      note("beat-three", "G"),
      note("beat-four", "A"),
    ];

    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: [
        "p0/m0/s0/triplet-a",
        "p0/m0/s0/triplet-b",
        "p0/m0/s0/triplet-c",
        "p0/m0/s0/beat-two",
        "p0/m0/s0/beat-three",
        "p0/m0/s0/beat-four",
      ],
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    const sequence = result.score.parts[0]!.measures[0]!.sequences[0]!;
    expect(sequence.content).toEqual([]);
    expect(sequence.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
  });

  it("removes a dynamic anchored in a fully deleted tuplet before collapsing its bar", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        outer: { duration: { base: "quarter" }, multiple: 1 },
        inner: { duration: { base: "eighth" }, multiple: 3 },
        content: [
          { ...note("triplet-a"), duration: { base: "eighth" } },
          { ...note("triplet-b", "D"), duration: { base: "eighth" } },
          { ...note("triplet-c", "E"), duration: { base: "eighth" } },
        ],
      },
    ];
    toggleDynamic(score, 0, 0, 0, 1, "f", 0);

    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/triplet-a", "p0/m0/s0/triplet-b", "p0/m0/s0/triplet-c"],
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    const measure = result.score.parts[0]!.measures[0]!;
    expect(measure.sequences[0]!.content).toEqual([]);
    expect(measure.sequences[0]!.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
    expect(measure.dynamics).toBeUndefined();
  });

  it("retains a dynamic when deleting only part of its tuplet", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        outer: { duration: { base: "quarter" }, multiple: 1 },
        inner: { duration: { base: "eighth" }, multiple: 3 },
        content: [
          { ...note("triplet-a"), duration: { base: "eighth" } },
          { ...note("triplet-b", "D"), duration: { base: "eighth" } },
          { ...note("triplet-c", "E"), duration: { base: "eighth" } },
        ],
      },
    ];
    toggleDynamic(score, 0, 0, 0, 1, "f", 0);

    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/triplet-b"],
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    const measure = result.score.parts[0]!.measures[0]!;
    expect(measure.dynamics).toHaveLength(1);
    const tuplet = measure.sequences[0]!.content[0];
    expect(tuplet?.type).toBe("tuplet");
    if (tuplet?.type !== "tuplet") return;
    expect(tuplet.content[1]).toMatchObject({ type: "event", rest: {} });
  });

  it("retains an unscoped dynamic while another voice still supplies its anchor", () => {
    const score = makeScore();
    const measure = score.parts[0]!.measures[0]!;
    measure.sequences = [
      {
        content: [
          {
            type: "tuplet",
            outer: { duration: { base: "quarter" }, multiple: 1 },
            inner: { duration: { base: "eighth" }, multiple: 3 },
            content: [
              { ...note("triplet-a"), duration: { base: "eighth" } },
              { ...note("triplet-b", "D"), duration: { base: "eighth" } },
              { ...note("triplet-c", "E"), duration: { base: "eighth" } },
            ],
          },
        ],
      },
      { content: [note("other-voice")] },
    ];
    measure.dynamics = [{ id: "shared-dynamic", type: "immediate", position: { fraction: [0, 1] }, value: "f" }];

    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/triplet-a", "p0/m0/s0/triplet-b", "p0/m0/s0/triplet-c"],
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    expect(result.score.parts[0]!.measures[0]!.dynamics).toHaveLength(1);
  });

  it("removes a selected tuplet bracket and restores its base rest with attached dynamics", () => {
    const score = makeScore();
    const measure = score.parts[0]!.measures[0]!;
    measure.sequences[0]!.content = [
      {
        type: "tuplet",
        outer: { duration: { base: "quarter" }, multiple: 1 },
        inner: { duration: { base: "eighth" }, multiple: 5 },
        content: Array.from({ length: 5 }, () => ({
          type: "event" as const,
          duration: { base: "eighth" as const },
          rest: {},
        })),
      },
    ];
    toggleDynamic(score, 0, 0, 0, 0, "f", 0);

    const result = computeDeleteSelection(score, {
      kind: "single",
      elementId: "p0/m0/s0/tuplet0",
      elementType: "tuplet",
    });

    expect(result).toMatchObject({ kind: "single", nextSelection: { kind: "clear" } });
    if (result.kind !== "single") return;
    expect(result.score.parts[0]!.measures[0]!.sequences[0]!.content).toMatchObject([
      { type: "event", duration: { base: "quarter" }, rest: {} },
    ]);
    expect(result.score.parts[0]!.measures[0]!.dynamics).toHaveLength(1);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.type).toBe("tuplet");
  });

  it("returns noop for an empty selection", () => {
    expect(computeDeleteSelection(makeScore(), { kind: "none" }).kind).toBe("noop");
  });

  it("deletes a selected key change globally without changing downstream note pitches", () => {
    const score = makeScore();
    score.global.measures[0]!.key = { fifths: 3 };
    const pitches = score.parts[0]!.measures[0]!.sequences[0]!.content;

    const result = computeDeleteSelection(score, { kind: "single", elementId: "p0/m0/key" });

    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.score.global.measures[0]!.key).toBeUndefined();
    expect(result.score.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(pitches);
    expect(result.nextSelection).toEqual({ kind: "clear" });
  });

  it("deletes a selected measure-repeat sign without changing the measure content", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.measureRepeat = { number: 1 };
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;

    const result = computeDeleteSelection(score, {
      kind: "single",
      elementId: "p0/m0/measurerepeat",
    });

    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.score.parts[0]!.measures[0]!.measureRepeat).toBeUndefined();
    expect(result.score.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(content);
    expect(result.nextSelection).toEqual({ kind: "clear" });
  });

  it("deletes every measure repeat in a Shift-click range", () => {
    const score = makeScore();
    score.global.measures.push({}, {});
    score.parts[0]!.measures.push(
      { sequences: [{ content: [] }], measureRepeat: { number: 1 } },
      { sequences: [{ content: [] }], measureRepeat: { number: 1 } },
    );
    score.parts[0]!.measures[0]!.measureRepeat = { number: 1 };

    const result = computeDeleteSelection(score, {
      kind: "range",
      startElementId: "p0/m0/measurerepeat",
      endElementId: "p0/m2/measurerepeat",
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    expect(result.score.parts[0]!.measures.every((measure) => measure.measureRepeat === undefined)).toBe(true);
  });

  it("deletes a selected global coda marker", () => {
    const score = makeScore();
    score.global.measures = Array.from({ length: 116 }, (_, index) => ({ id: `m${index}` }));
    score.global.measures[115]!.coda = { location: { fraction: [0, 1] } };

    const result = computeDeleteSelection(score, { kind: "single", elementId: "m115/coda" });

    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.score.global.measures[115]!.coda).toBeUndefined();
    expect(result.nextSelection).toEqual({ kind: "clear" });
  });

  it("deletes explicitly selected grace notes in a multi-selection", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "grace",
        content: [note("grace-a"), note("grace-b", "D")],
      },
      note("parent", "E"),
      note("ordinary", "F"),
    ];

    const result = computeDeleteSelection(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/parent/grace/grace-a", "p0/m0/s0/parent/grace/grace-b", "p0/m0/s0/ordinary"],
    });

    expect(result.kind).toBe("multi");
    if (result.kind !== "multi") return;
    const content = result.score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content.some((item) => item.type === "grace")).toBe(false);
    expect((content[0] as NoteEvent).id).toBe("parent");
    expect((content[1] as NoteEvent).rest).toBeDefined();
    expect(result.nextSelection).toEqual({ kind: "clear" });
  });
});

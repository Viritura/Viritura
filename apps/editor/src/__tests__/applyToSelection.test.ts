import { describe, it, expect } from "vitest";
import type { Score, NoteEvent, Step, Octave } from "@viritura/core";
import {
  applyArticulationToSelection,
  applyTremoloToSelection,
  removeTremolosFromSelection,
  applyFingeringToSelection,
  applyOrnamentToSelection,
  applyTrillToSelection,
} from "../radialMenu/applyToSelection";
import { getEventAtLocation } from "../score/ElementPath";
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

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        name: "Violin",
        measures: [{ sequences: [{ content: [chord("ev0"), note("ev1", "D"), note("ev2", "E")] }] }],
      },
    ],
  };
}

function markingsOf(score: Score, eventIndex: number): NonNullable<NoteEvent["markings"]> | undefined {
  const ev = getEventAtLocation(score, { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex });
  return ev?.type === "event" ? ev.markings : undefined;
}

describe("applyArticulationToSelection", () => {
  it("toggles a chord exactly once when two of its noteheads are selected (no double-cancel)", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0/n0", "p0/m0/s0/ev0/n2"] };
    const next = applyArticulationToSelection(makeScore(), sel, "staccato");
    expect(next).not.toBeNull();
    // Dedup: a single toggle adds staccato. The old two-pass code cancelled it back off.
    expect(markingsOf(next!, 0)?.staccato).toBeDefined();
  });

  it("applies to every event of a multi selection", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    const next = applyArticulationToSelection(makeScore(), sel, "staccato");
    expect(markingsOf(next!, 1)?.staccato).toBeDefined();
    expect(markingsOf(next!, 2)?.staccato).toBeDefined();
  });

  it("unifies a mixed on/off selection to ON instead of inverting each note", () => {
    // ev1 already staccato, ev2 not. "Match" semantics: turn the whole
    // selection ON rather than independently flipping each (which would have
    // cleared ev1 and set ev2).
    const score = makeScore();
    const seeded = applyArticulationToSelection(
      score,
      {
        kind: "single",
        elementId: "p0/m0/s0/ev1",
        elementType: "event",
      } satisfies Selection,
      "staccato",
    )!;
    expect(markingsOf(seeded, 1)?.staccato).toBeDefined();
    expect(markingsOf(seeded, 2)?.staccato).toBeUndefined();

    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    const next = applyArticulationToSelection(seeded, sel, "staccato")!;
    expect(markingsOf(next, 1)?.staccato).toBeDefined();
    expect(markingsOf(next, 2)?.staccato).toBeDefined();
  });

  it("clears a fully-on selection on the next press", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    const allOn = applyArticulationToSelection(makeScore(), sel, "staccato")!;
    expect(markingsOf(allOn, 1)?.staccato).toBeDefined();
    expect(markingsOf(allOn, 2)?.staccato).toBeDefined();

    const cleared = applyArticulationToSelection(allOn, sel, "staccato")!;
    expect(markingsOf(cleared, 1)?.staccato).toBeUndefined();
    expect(markingsOf(cleared, 2)?.staccato).toBeUndefined();
  });

  it("returns null for an empty selection", () => {
    expect(applyArticulationToSelection(makeScore(), { kind: "none" }, "staccato")).toBeNull();
  });
});

describe("applyTremoloToSelection", () => {
  it("applies to a single event", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev1", elementType: "event" };
    const next = applyTremoloToSelection(makeScore(), sel, 2);
    expect(markingsOf(next!, 1)?.tremolo).toEqual({ marks: 2 });
  });

  it("clears a single-note tremolo", () => {
    const score = makeScore();
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev1", elementType: "event" };
    const marked = applyTremoloToSelection(score, sel, 2)!;
    const cleared = removeTremolosFromSelection(marked, sel)!;
    expect(markingsOf(cleared, 1)?.tremolo).toBeUndefined();
  });

  it("unwraps a selected two-note tremolo and restores individual durations", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tremolo",
        marks: 2,
        outer: { duration: { base: "quarter" }, multiple: 2 },
        individualDuration: { base: "quarter" },
        content: [
          { ...note("a"), duration: { base: "half" } },
          { ...note("b", "E"), duration: { base: "half" } },
        ],
      },
    ];
    const cleared = removeTremolosFromSelection(score, {
      kind: "single",
      elementId: "p0/m0/s0/a",
      elementType: "event",
    })!;
    const content = cleared.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content.map((event) => event.type)).toEqual(["event", "event"]);
    expect(content.map((event) => event.duration)).toEqual([{ base: "quarter" }, { base: "quarter" }]);
  });
});

describe("applyFingeringToSelection (now multi-aware)", () => {
  it("adds the finger to every event of a multi selection", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    const next = applyFingeringToSelection(makeScore(), sel, 3);
    expect(next).not.toBeNull();
    expect(markingsOf(next!, 1)?.fingerings).toEqual([{ finger: 3 }]);
    expect(markingsOf(next!, 2)?.fingerings).toEqual([{ finger: 3 }]);
  });

  it("still works for a single event", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev1", elementType: "event" };
    const next = applyFingeringToSelection(makeScore(), sel, 1);
    expect(markingsOf(next!, 1)?.fingerings).toEqual([{ finger: 1 }]);
  });

  it("unifies a mixed selection to ON instead of inverting each note", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    // Seed finger 3 on ev1 only.
    const seeded = applyFingeringToSelection(
      makeScore(),
      {
        kind: "single",
        elementId: "p0/m0/s0/ev1",
        elementType: "event",
      } satisfies Selection,
      3,
    )!;
    expect(markingsOf(seeded, 1)?.fingerings).toEqual([{ finger: 3 }]);
    expect(markingsOf(seeded, 2)?.fingerings).toBeUndefined();

    const next = applyFingeringToSelection(seeded, sel, 3)!;
    expect(markingsOf(next, 1)?.fingerings).toEqual([{ finger: 3 }]);
    expect(markingsOf(next, 2)?.fingerings).toEqual([{ finger: 3 }]);
  });

  it("clears a fully-fingered selection on the next press, preserving other fingers", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    // ev1 has fingers 2 and 3; ev2 has finger 3.
    let score = applyFingeringToSelection(makeScore(), sel, 3)!;
    score = applyFingeringToSelection(
      score,
      {
        kind: "single",
        elementId: "p0/m0/s0/ev1",
        elementType: "event",
      } satisfies Selection,
      2,
    )!;
    expect(markingsOf(score, 1)?.fingerings).toEqual([{ finger: 3 }, { finger: 2 }]);

    // Both carry finger 3 → second press removes 3 from all, keeps finger 2 on ev1.
    const cleared = applyFingeringToSelection(score, sel, 3)!;
    expect(markingsOf(cleared, 1)?.fingerings).toEqual([{ finger: 2 }]);
    expect(markingsOf(cleared, 2)?.fingerings).toBeUndefined();
  });
});

describe("applyOrnamentToSelection (match semantics)", () => {
  it("unifies a mixed selection to ON, preserving other ornaments", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    // ev1 already has a mordent; ev2 has none.
    const seeded = applyOrnamentToSelection(
      makeScore(),
      {
        kind: "single",
        elementId: "p0/m0/s0/ev1",
        elementType: "event",
      } satisfies Selection,
      "mordent",
    )!;
    const next = applyOrnamentToSelection(seeded, sel, "turn")!;
    expect(markingsOf(next, 1)?.ornaments).toEqual(["mordent", "turn"]);
    expect(markingsOf(next, 2)?.ornaments).toEqual(["turn"]);
  });

  it("clears a fully-ornamented selection on the next press", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    const allOn = applyOrnamentToSelection(makeScore(), sel, "turn")!;
    expect(markingsOf(allOn, 1)?.ornaments).toEqual(["turn"]);
    const cleared = applyOrnamentToSelection(allOn, sel, "turn")!;
    expect(markingsOf(cleared, 1)?.ornaments).toBeUndefined();
    expect(markingsOf(cleared, 2)?.ornaments).toBeUndefined();
  });
});

describe("applyTrillToSelection (match semantics)", () => {
  it("unifies a mixed selection to ON without clobbering an existing accidental", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    // ev1 already trilled; ev2 not.
    const seeded = applyTrillToSelection(makeScore(), {
      kind: "single",
      elementId: "p0/m0/s0/ev1",
      elementType: "event",
    } satisfies Selection)!;
    const next = applyTrillToSelection(seeded, sel)!;
    expect(markingsOf(next, 1)?.trill).toBeDefined();
    expect(markingsOf(next, 2)?.trill).toBeDefined();
  });

  it("clears a fully-trilled selection on the next press", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev2"] };
    const allOn = applyTrillToSelection(makeScore(), sel)!;
    expect(markingsOf(allOn, 1)?.trill).toBeDefined();
    const cleared = applyTrillToSelection(allOn, sel)!;
    expect(markingsOf(cleared, 1)?.trill).toBeUndefined();
    expect(markingsOf(cleared, 2)?.trill).toBeUndefined();
  });
});

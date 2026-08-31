import { describe, it, expect } from "vitest";
import type { Score, NoteEvent, Step, Octave } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import type { KeyboardHandlerContext } from "../keyboard/types";
import {
  applyAccidentalToSelection,
  handleArrowUpDown,
  stepAccidentalOnSelection,
  handleSlurKey,
  handleTieKey,
} from "../keyboard/normalModeHandlers";
import { handleDelete } from "../keyboard/normalModeDelete";

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

// [ev0 (chord), ev1, ev2, ev3] in one sequence so we can act on non-adjacent
// events without triggering adjacent-rest merges.
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [{ content: [chord("ev0"), note("ev1", "D"), note("ev2", "E"), note("ev3", "F")] }],
            dynamics: [
              { id: "dyn-a", type: "immediate", position: { fraction: [0, 1] }, value: "f" },
              { id: "dyn-b", type: "immediate", position: { fraction: [1, 4] }, value: "p" },
              {
                id: "hairpin-a",
                type: "gradual",
                position: { fraction: [1, 4] },
                end: { measure: "m0", position: { fraction: [1, 1] } },
                wedgeType: "increasing",
              },
            ],
          },
        ],
      },
    ],
  };
}

function contentAt(score: Score, i: number): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[i] as NoteEvent;
}

/** Minimal context: only the getters/setters the edit handlers actually touch. */
function makeCtx(score: Score, selection: Selection): { ctx: KeyboardHandlerContext; latest: () => Score } {
  let current = score;
  const ctx = {
    getScore: () => current,
    getSelection: () => selection,
    updateScore: (next: Score) => {
      current = next;
    },
    clearSelection: () => {},
  } as unknown as KeyboardHandlerContext;
  return { ctx, latest: () => current };
}

const noopEvent = { preventDefault() {} } as unknown as KeyboardEvent;

describe("keyboard edit handlers — multi-aware", () => {
  it("resets explicit 5/4 rests to a bar rest when deleting one", () => {
    const score = makeScore();
    score.global.measures[0]!.time = { count: 5, unit: 4 };
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", id: "whole-rest", duration: { base: "whole" }, rest: {} },
      { type: "event", id: "quarter-rest", duration: { base: "quarter" }, rest: {} },
    ];
    const { ctx, latest } = makeCtx(score, {
      kind: "single",
      elementId: "p0/m0/s0/whole-rest",
      elementType: "rest",
    });

    handleDelete(noopEvent, false, ctx);

    expect(latest().parts[0]!.measures[0]!.sequences[0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
  });

  it("ties every adjacent matching note in a continuous range", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [note("ev0"), note("ev1"), note("ev2"), note("ev3")];
    const { ctx, latest } = makeCtx(score, {
      kind: "range",
      startElementId: "p0/m0/s0/ev0",
      endElementId: "p0/m0/s0/ev3",
    });

    handleTieKey(noopEvent, ctx);

    const events = latest().parts[0]!.measures[0]!.sequences[0]!.content as NoteEvent[];
    for (let index = 0; index < events.length - 1; index++) {
      expect(events[index]!.notes![0]!.ties).toEqual([{ target: events[index + 1]!.notes![0]!.id }]);
    }
    expect(events[3]!.notes![0]!.ties).toBeUndefined();
  });

  it("deletes a single visual A2 note from every merged source", () => {
    const score = makeScore();
    score.parts[0]!.id = "part-0";
    const second = structuredClone(score.parts[0]!);
    second.id = "part-1";
    second.measures[0]!.sequences[0]!.content = [
      note("peer-0"),
      note("peer-1", "D"),
      note("peer-2", "E"),
      note("peer-3", "F"),
    ];
    score.parts.push(second);
    score.layouts = [
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "part-0" }, { part: "part-1" }] }],
      },
    ];
    score.scores = [{ name: "Condensed", layout: "condensed" }];
    const { ctx, latest } = makeCtx(score, {
      kind: "single",
      elementId: "p0/m0/s0/ev1",
      elementType: "event",
    });

    handleDelete(noopEvent, false, ctx);

    expect(latest().parts[0]!.measures[0]!.sequences[0]!.content[1]).toMatchObject({ rest: {} });
    expect(latest().parts[1]!.measures[0]!.sequences[0]!.content[1]).toMatchObject({ rest: {} });
  });

  it("deletes an A2 accidental from every merged source", () => {
    const score = makeScore();
    score.parts[0]!.id = "part-0";
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "source",
        duration: { base: "whole" },
        notes: [{ pitch: { step: "B", octave: 4, alter: -1 }, accidentalDisplay: { show: true } }],
      },
    ];
    const second = structuredClone(score.parts[0]!);
    second.id = "part-1";
    second.measures[0]!.sequences[0]!.content[0]!.id = "peer";
    score.parts.push(second);
    score.layouts = [
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "part-0" }, { part: "part-1" }] }],
      },
    ];
    score.scores = [{ name: "Condensed", layout: "condensed" }];
    const { ctx, latest } = makeCtx(score, {
      kind: "single",
      elementId: "p0/m0/s0/source/acc0",
      elementType: "accidental",
    });

    handleDelete(noopEvent, false, ctx);

    for (const part of latest().parts) {
      const event = part.measures[0]!.sequences[0]!.content[0] as NoteEvent;
      expect(event.notes![0]!.pitch.alter).toBeUndefined();
      expect(event.notes![0]!.accidentalDisplay).toBeUndefined();
    }
  });

  it("handleDelete blanks every distinct event in a multi selection", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0", "p0/m0/s0/ev2"] };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleDelete(noopEvent, false, ctx);
    const out = latest();
    expect(contentAt(out, 0).rest).toBeDefined();
    expect(contentAt(out, 1).notes).toBeDefined(); // ev1 untouched
    expect(contentAt(out, 2).rest).toBeDefined();
  });

  it("handleDelete removes selected grace notes from a multi selection", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "grace", content: [note("grace-a"), note("grace-b", "D")] },
      note("parent", "E"),
      note("ordinary", "F"),
    ];
    const { ctx, latest } = makeCtx(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/parent/grace/grace-a", "p0/m0/s0/parent/grace/grace-b", "p0/m0/s0/ordinary"],
    });

    handleDelete(noopEvent, false, ctx);

    const content = latest().parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content.some((item) => item.type === "grace")).toBe(false);
    expect((content[0] as NoteEvent).id).toBe("parent");
    expect((content[1] as NoteEvent).rest).toBeDefined();
  });

  it("handleDelete on a partial range leaves notes outside the selected span intact", () => {
    const { ctx, latest } = makeCtx(makeScore(), {
      kind: "range",
      startElementId: "p0/m0/s0/ev1",
      endElementId: "p0/m0/s0/ev2",
    });

    handleDelete(noopEvent, false, ctx);

    const out = latest();
    expect(contentAt(out, 0).notes).toBeDefined();
    expect(contentAt(out, 1).rest).toBeDefined();
    expect(contentAt(out, 2).rest).toBeDefined();
    expect(contentAt(out, 3).notes).toBeDefined();
  });

  it("transposes explicitly selected grace notes", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "grace", content: [note("grace-a"), note("grace-b", "D")] },
      note("parent", "E"),
    ];
    const { ctx, latest } = makeCtx(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/parent/grace/grace-a", "p0/m0/s0/parent/grace/grace-b"],
    });

    const event = {
      key: "ArrowUp",
      shiftKey: false,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    } as KeyboardEvent;
    handleArrowUpDown(event, true, ctx);

    const grace = latest().parts[0]!.measures[0]!.sequences[0]!.content[0] as { content: NoteEvent[] };
    expect(grace.content.map((item) => item.notes![0]!.pitch.octave)).toEqual([5, 5]);
    expect((latest().parts[0]!.measures[0]!.sequences[0]!.content[1] as NoteEvent).notes![0]!.pitch).toEqual({
      step: "E",
      octave: 4,
    });
  });

  it("transposes both a grace note and its parent when both are explicitly selected", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "grace", content: [note("grace-a")] },
      note("parent", "E"),
    ];
    const { ctx, latest } = makeCtx(score, {
      kind: "multi",
      elementIds: ["p0/m0/s0/parent/grace/grace-a", "p0/m0/s0/parent"],
    });

    const event = {
      key: "ArrowUp",
      shiftKey: false,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    } as KeyboardEvent;
    handleArrowUpDown(event, true, ctx);

    const content = latest().parts[0]!.measures[0]!.sequences[0]!.content;
    expect((content[0] as { content: NoteEvent[] }).content[0]!.notes![0]!.pitch.octave).toBe(5);
    expect((content[1] as NoteEvent).notes![0]!.pitch).toEqual({ step: "E", octave: 5 });
  });

  it("transposes grace notes attached to parent events inside a range", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      note("range-start", "C"),
      { type: "grace", content: [note("grace-a", "D"), note("grace-b", "E")] },
      note("parent", "F"),
      note("range-end", "G"),
    ];
    const { ctx, latest } = makeCtx(score, {
      kind: "range",
      startElementId: "p0/m0/s0/range-start",
      endElementId: "p0/m0/s0/range-end",
    });

    const event = {
      key: "ArrowUp",
      shiftKey: false,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    } as KeyboardEvent;
    handleArrowUpDown(event, true, ctx);

    const content = latest().parts[0]!.measures[0]!.sequences[0]!.content;
    expect((content[0] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
    expect((content[1] as { content: NoteEvent[] }).content.map((item) => item.notes![0]!.pitch.octave)).toEqual([
      5, 5,
    ]);
    expect((content[2] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
    expect((content[3] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
  });

  it("transposes trailing pre-barline grace notes attached after the last selected event", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      note("range-start", "C"),
      note("parent", "F"),
      { type: "grace", content: [note("before-bar-a", "D"), note("before-bar-b", "E")] },
    ];
    const { ctx, latest } = makeCtx(score, {
      kind: "range",
      startElementId: "p0/m0/s0/range-start",
      endElementId: "p0/m0/s0/parent",
    });

    const event = {
      key: "ArrowUp",
      shiftKey: false,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    } as KeyboardEvent;
    handleArrowUpDown(event, true, ctx);

    const content = latest().parts[0]!.measures[0]!.sequences[0]!.content;
    expect((content[0] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
    expect((content[1] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
    expect((content[2] as { content: NoteEvent[] }).content.map((item) => item.notes![0]!.pitch.octave)).toEqual([
      5, 5,
    ]);
  });

  it("handleDelete removes multiple selected dynamics", () => {
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/dyndyn-a", "p0/m0/dyndyn-b"],
    };
    const { ctx, latest } = makeCtx(makeScore(), sel);

    handleDelete(noopEvent, false, ctx);

    expect(latest().parts[0]!.measures[0]!.dynamics!.map((group) => group.id)).toEqual(["hairpin-a"]);
    expect(contentAt(latest(), 0).notes).toBeDefined();
  });

  it("handleDelete removes a mixed dynamic and hairpin selection", () => {
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/dyndyn-a", "p0/m0/hairpinhairpin-a"],
    };
    const { ctx, latest } = makeCtx(makeScore(), sel);

    handleDelete(noopEvent, false, ctx);

    expect(latest().parts[0]!.measures[0]!.dynamics!.map((group) => group.id)).toEqual(["dyn-b"]);
    expect(contentAt(latest(), 0).notes).toBeDefined();
  });

  it("handleDelete removes multiple index-addressed dynamics back-to-front", () => {
    const score = makeScore();
    for (const group of score.parts[0]!.measures[0]!.dynamics!) delete group.id;
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/dyn0", "p0/m0/dyn1"],
    };
    const { ctx, latest } = makeCtx(score, sel);

    handleDelete(noopEvent, false, ctx);

    expect(latest().parts[0]!.measures[0]!.dynamics).toHaveLength(1);
    expect(latest().parts[0]!.measures[0]!.dynamics![0]!.type).toBe("gradual");
  });

  it("handleDelete removes only the selected noteheads from a chord", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev0/n0", "p0/m0/s0/ev0/n2"] };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleDelete(noopEvent, false, ctx);
    const out = latest();
    // C and G go; E stays, so the event is still a note — not a rest.
    expect(contentAt(out, 0).rest).toBeUndefined();
    expect(contentAt(out, 0).notes!.map((n) => n.pitch.step)).toEqual(["E"]);
    expect(contentAt(out, 1).notes).toBeDefined();
  });

  it("handleDelete blanks a chord when every notehead is selected", () => {
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/s0/ev0/n0", "p0/m0/s0/ev0/n1", "p0/m0/s0/ev0/n2"],
    };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleDelete(noopEvent, false, ctx);
    const out = latest();
    expect(contentAt(out, 0).rest).toBeDefined();
    expect(contentAt(out, 0).notes).toBeUndefined();
  });

  it("handleDelete on a single notehead leaves the rest of the chord", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev0/n1" };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleDelete(noopEvent, false, ctx);
    const out = latest();
    expect(contentAt(out, 0).notes!.map((n) => n.pitch.step)).toEqual(["C", "G"]);
  });

  it("handleDelete on the only notehead of a single-note event blanks it", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/ev1/n0" };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleDelete(noopEvent, false, ctx);
    const out = latest();
    expect(contentAt(out, 1).rest).toBeDefined();
    expect(contentAt(out, 1).notes).toBeUndefined();
  });

  it("handleDelete removes a selected global key signature", () => {
    const score = makeScore();
    score.global.measures[0]!.key = { fifths: -3 };
    const { ctx, latest } = makeCtx(score, { kind: "single", elementId: "p0/m0/key" });

    handleDelete(noopEvent, false, ctx);

    expect(latest().global.measures[0]!.key).toBeUndefined();
    expect(contentAt(latest(), 1).notes![0]!.pitch).toEqual({ step: "D", octave: 4 });
  });

  it("applyAccidentalToSelection applies the accidental to every selected event", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev3"] };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    const ok = applyAccidentalToSelection("sharp", ctx);
    expect(ok).toBe(true);
    const out = latest();
    expect(contentAt(out, 1).notes![0]!.pitch.alter).toBe(1);
    expect(contentAt(out, 2).notes![0]!.pitch.alter).toBeUndefined(); // ev2 untouched
    expect(contentAt(out, 3).notes![0]!.pitch.alter).toBe(1);
  });

  it("edit handlers no-op on an empty selection", () => {
    const { ctx, latest } = makeCtx(makeScore(), { kind: "none" });
    handleDelete(noopEvent, false, ctx);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(false);
    expect(contentAt(latest(), 0).notes).toBeDefined(); // unchanged
  });

  it("handleSlurKey on a bar (measure) selection slurs first→last covered note", () => {
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleSlurKey(noopEvent, ctx);
    const out = latest();
    // A single slur spans the bar's first note (ev0) to its last (ev3).
    expect(contentAt(out, 0).slurs).toHaveLength(1);
    expect(contentAt(out, 0).slurs![0]!.target).toBe("ev3");
    expect(contentAt(out, 1).slurs).toBeUndefined();
    expect(contentAt(out, 2).slurs).toBeUndefined();
  });

  it("handleSlurKey on a multi selection slurs first→last selected note", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/ev1", "p0/m0/s0/ev3"] };
    const { ctx, latest } = makeCtx(makeScore(), sel);
    handleSlurKey(noopEvent, ctx);
    const out = latest();
    expect(contentAt(out, 1).slurs).toHaveLength(1);
    expect(contentAt(out, 1).slurs![0]!.target).toBe("ev3");
    expect(contentAt(out, 0).slurs).toBeUndefined();
  });

  it("handleSlurKey on a single grace note slurs it to its principal", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [
        {
          name: "Violin",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "grace",
                      content: [
                        {
                          type: "event",
                          id: "grace-1",
                          duration: { base: "eighth" },
                          notes: [{ pitch: { step: "D", octave: 5 } }],
                        },
                      ],
                    },
                    note("principal-1", "C", 5),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/principal-1/grace/grace-1" };
    const { ctx, latest } = makeCtx(score, sel);
    handleSlurKey(noopEvent, ctx);
    const out = latest();
    const graceEv = (out.parts[0]!.measures[0]!.sequences[0]!.content[0] as { content: NoteEvent[] }).content[0]!;
    expect(graceEv.slurs).toHaveLength(1);
    expect(graceEv.slurs![0]!.target).toBe("principal-1");

    // Pressing S again toggles the slur back off.
    handleSlurKey(noopEvent, ctx);
    const off = latest();
    const graceOff = (off.parts[0]!.measures[0]!.sequences[0]!.content[0] as { content: NoteEvent[] }).content[0]!;
    expect(graceOff.slurs).toBeUndefined();
  });

  it("toggles a slur from the last tuplet note to the following event", () => {
    const tuplet = {
      type: "tuplet" as const,
      outer: { duration: { base: "quarter" as const }, multiple: 1 },
      inner: { duration: { base: "eighth" as const }, multiple: 3 },
      content: [note("triplet-0"), note("triplet-1"), note("triplet-2")],
    };
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [
        {
          name: "Violin",
          measures: [{ sequences: [{ content: [tuplet, note("after-tuplet")] }] }],
        },
      ],
    };
    const { ctx, latest } = makeCtx(score, { kind: "single", elementId: "p0/m0/s0/triplet-2" });

    handleSlurKey(noopEvent, ctx);
    const addedTuplet = latest().parts[0]!.measures[0]!.sequences[0]!.content[0] as typeof tuplet;
    expect(addedTuplet.content[2]!.slurs).toEqual([{ target: "after-tuplet" }]);

    handleSlurKey(noopEvent, ctx);
    const removedTuplet = latest().parts[0]!.measures[0]!.sequences[0]!.content[0] as typeof tuplet;
    expect(removedTuplet.content[2]!.slurs).toBeUndefined();
  });

  it("uses the surrounding top-level notes as measure-slur endpoints", () => {
    const tuplet = {
      type: "tuplet" as const,
      outer: { duration: { base: "quarter" as const }, multiple: 1 },
      inner: { duration: { base: "eighth" as const }, multiple: 3 },
      content: [note("triplet-0"), note("triplet-1"), note("triplet-2")],
    };
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [
        {
          name: "Violin",
          measures: [{ sequences: [{ content: [note("before-tuplet"), tuplet, note("after-tuplet")] }] }],
        },
      ],
    };
    const selection: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const { ctx, latest } = makeCtx(score, selection);

    handleSlurKey(noopEvent, ctx);

    expect(contentAt(latest(), 0).slurs).toEqual([{ target: "after-tuplet" }]);
    expect(tuplet.content[0]!.slurs).toBeUndefined();
  });

  it("handleSlurKey on a multi-staff bar selection slurs each staff independently", () => {
    // Two parts, each a 4-note bar. A measure selection covering both parts
    // should produce one slur per staff (first→last of that staff), not a
    // single cross-staff slur.
    const twoPart: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [
        {
          name: "Violin",
          measures: [
            { sequences: [{ content: [note("a0", "C"), note("a1", "D"), note("a2", "E"), note("a3", "F")] }] },
          ],
        },
        {
          name: "Cello",
          measures: [
            { sequences: [{ content: [note("b0", "C"), note("b1", "D"), note("b2", "E"), note("b3", "F")] }] },
          ],
        },
      ],
    };
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 1,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const { ctx, latest } = makeCtx(twoPart, sel);
    handleSlurKey(noopEvent, ctx);
    const out = latest();
    const partContent = (p: number, i: number) => out.parts[p]!.measures[0]!.sequences[0]!.content[i] as NoteEvent;
    // Part 0: slur a0 → a3
    expect(partContent(0, 0).slurs).toHaveLength(1);
    expect(partContent(0, 0).slurs![0]!.target).toBe("a3");
    // Part 1: its own slur b0 → b3 (not reaching across staves)
    expect(partContent(1, 0).slurs).toHaveLength(1);
    expect(partContent(1, 0).slurs![0]!.target).toBe("b3");
  });

  it("handleSlurKey skips a voice that has only one covered note", () => {
    // Multi selection: two notes in part 0, one note in part 1. Part 0 gets a
    // slur; part 1 has nothing to span, so it's left untouched.
    const twoPart: Score = {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [
        {
          name: "Violin",
          measures: [{ sequences: [{ content: [note("a0", "C"), note("a1", "D"), note("a2", "E")] }] }],
        },
        {
          name: "Cello",
          measures: [{ sequences: [{ content: [note("b0", "C"), note("b1", "D"), note("b2", "E")] }] }],
        },
      ],
    };
    const sel: Selection = {
      kind: "multi",
      elementIds: ["p0/m0/s0/a0", "p0/m0/s0/a1", "p1/m0/s0/b0"],
    };
    const { ctx, latest } = makeCtx(twoPart, sel);
    handleSlurKey(noopEvent, ctx);
    const out = latest();
    const partContent = (p: number, i: number) => out.parts[p]!.measures[0]!.sequences[0]!.content[i] as NoteEvent;
    // Part 0: slur a0 → a1
    expect(partContent(0, 0).slurs).toHaveLength(1);
    expect(partContent(0, 0).slurs![0]!.target).toBe("a1");
    // Part 1: single covered note — no slur added anywhere in the voice.
    expect(partContent(1, 0).slurs).toBeUndefined();
    expect(partContent(1, 1).slurs).toBeUndefined();
  });
});

describe("applyAccidentalToSelection / stepAccidentalOnSelection — direct set & stepping", () => {
  function noteEv(id: string, step: Step, octave: Octave, alter?: number): NoteEvent {
    return {
      type: "event",
      id,
      duration: { base: "quarter" },
      notes: [{ pitch: { step, octave, ...(alter !== undefined ? { alter } : {}) } }],
    };
  }

  function scoreWith(events: NoteEvent[]): Score {
    return {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [{ name: "P", measures: [{ sequences: [{ content: events }] }] }],
    };
  }

  function selId(id: string): Selection {
    return { kind: "multi", elementIds: [`p0/m0/s0/${id}`] };
  }

  function alterOf(score: Score, i: number): number | undefined {
    return (score.parts[0]!.measures[0]!.sequences[0]!.content[i] as NoteEvent).notes![0]!.pitch.alter;
  }

  it("a direct-set key replaces whatever accidental the note had (no toggle)", () => {
    const { ctx, latest } = makeCtx(scoreWith([noteEv("e0", "F", 4, 1)]), selId("e0"));
    // Re-pressing the note's existing sharp keeps it sharp — it sets, never reverts.
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(1);
    // A different accidental replaces it.
    expect(applyAccidentalToSelection("flat", ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(-1);
  });

  it("stepAccidentalOnSelection nudges the note's own alter up and down", () => {
    const { ctx, latest } = makeCtx(scoreWith([noteEv("e0", "F", 4)]), selId("e0"));
    expect(stepAccidentalOnSelection(1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(1); // natural → sharp
    expect(stepAccidentalOnSelection(1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(2); // sharp → double-sharp
    expect(stepAccidentalOnSelection(-1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(1); // back down to sharp
  });

  it("stepping is relative to each note's existing alter and clamps at the extremes", () => {
    const { ctx, latest } = makeCtx(scoreWith([noteEv("e0", "F", 4, 3)]), selId("e0"));
    // Already triple-sharp; stepping up is clamped (stays 3).
    expect(stepAccidentalOnSelection(1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(3);
    // Stepping down passes through natural (undefined) on the way.
    expect(stepAccidentalOnSelection(-1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(2);
  });

  it("stepping crosses natural cleanly (alter omitted at 0)", () => {
    const { ctx, latest } = makeCtx(scoreWith([noteEv("e0", "F", 4, 1)]), selId("e0"));
    expect(stepAccidentalOnSelection(-1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBeUndefined(); // sharp → natural (omitted)
    expect(stepAccidentalOnSelection(-1, ctx)).toBe(true);
    expect(alterOf(latest(), 0)).toBe(-1); // natural → flat
  });

  it("both helpers no-op on an empty selection", () => {
    const { ctx } = makeCtx(scoreWith([noteEv("e0", "F", 4)]), { kind: "none" });
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(false);
    expect(stepAccidentalOnSelection(1, ctx)).toBe(false);
  });
});

describe("accidentals — multi-select & notehead granularity", () => {
  function chord(id: string, notes: { step: Step; octave: Octave; alter?: number }[]): NoteEvent {
    return {
      type: "event",
      id,
      duration: { base: "quarter" },
      notes: notes.map((n) => ({
        pitch: { step: n.step, octave: n.octave, ...(n.alter !== undefined ? { alter: n.alter } : {}) },
      })),
    };
  }

  function scoreWith(events: NoteEvent[]): Score {
    return {
      mnx: { version: 1 },
      global: { measures: [{ id: "m0" }] },
      parts: [{ name: "P", measures: [{ sequences: [{ content: events }] }] }],
    };
  }

  function alters(score: Score, i: number): (number | undefined)[] {
    return (score.parts[0]!.measures[0]!.sequences[0]!.content[i] as NoteEvent).notes!.map((n) => n.pitch.alter);
  }

  const cMajChord = (id: string) =>
    chord(id, [
      { step: "C", octave: 4 },
      { step: "E", octave: 4 },
      { step: "G", octave: 4 },
    ]);

  it("a single selected notehead is the only note sharped in its chord", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/c0/n1"] };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([undefined, 1, undefined]); // only E (index 1)
  });

  it("two selected noteheads of a chord are sharped; the third is untouched", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/c0/n0", "p0/m0/s0/c0/n2"] };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([1, undefined, 1]); // C and G, not E
  });

  it("selecting the whole chord event sharps every note", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/c0"] };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([1, 1, 1]);
  });

  it("whole-event coverage wins when a chord is selected both ways", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/c0/n1", "p0/m0/s0/c0"] };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0")]), sel);
    expect(applyAccidentalToSelection("flat", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([-1, -1, -1]);
  });

  it("stepping a single notehead nudges only that note", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/c0/n2"] };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0")]), sel);
    expect(stepAccidentalOnSelection(1, ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([undefined, undefined, 1]); // only G
  });

  it("multi-select across chords only touches the picked noteheads", () => {
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/c0/n0", "p0/m0/s0/c1/n2"] };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0"), cMajChord("c1")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([1, undefined, undefined]); // c0: C only
    expect(alters(latest(), 1)).toEqual([undefined, undefined, 1]); // c1: G only
  });

  it("measure selection sharps every note of every covered chord", () => {
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0"), cMajChord("c1")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([1, 1, 1]);
    expect(alters(latest(), 1)).toEqual([1, 1, 1]);
  });

  it("a range selection covers every note of every event between the endpoints", () => {
    const sel: Selection = {
      kind: "range",
      startElementId: "p0/m0/s0/c0",
      endElementId: "p0/m0/s0/c1",
    };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0"), cMajChord("c1")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([1, 1, 1]);
    expect(alters(latest(), 1)).toEqual([1, 1, 1]);
  });

  it("a rest covered by a measure selection is skipped without error", () => {
    const rest: NoteEvent = { type: "event", id: "r0", duration: { base: "quarter" }, rest: {} };
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const { ctx, latest } = makeCtx(scoreWith([cMajChord("c0"), rest, cMajChord("c1")]), sel);
    expect(applyAccidentalToSelection("sharp", ctx)).toBe(true);
    expect(alters(latest(), 0)).toEqual([1, 1, 1]);
    expect((latest().parts[0]!.measures[0]!.sequences[0]!.content[1] as NoteEvent).rest).toEqual({});
    expect(alters(latest(), 2)).toEqual([1, 1, 1]);
  });
});

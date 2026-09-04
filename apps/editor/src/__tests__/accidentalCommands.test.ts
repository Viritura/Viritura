import { describe, it, expect } from "vitest";
import type { Note, NoteEvent, Score } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { handleDelete } from "../keyboard/normalModeDelete";
import {
  isAccidentalId,
  prevailingAlteration,
  prevailingAlterationAtPosition,
  removeAccidental,
  setAccidentalOnEvent,
} from "../commands/accidentalCommands";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { resolveEventLocation } from "../score/ElementPath";

/** Score with one part, one measure, and the given events in voice 0. */
function makeScore(events: NoteEvent[], fifths?: number): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, ...(fifths === undefined ? {} : { key: { fifths } }) }],
    },
    parts: [{ name: "Piano", measures: [{ sequences: [{ content: events }] }] }],
  } as unknown as Score;
}

function note(step: string, octave: number, alter?: number, extra: Partial<Note> = {}): Note {
  return { pitch: { step, octave, ...(alter === undefined ? {} : { alter }) }, ...extra } as Note;
}

function event(id: string, notes: Note[]): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, notes } as unknown as NoteEvent;
}

const ACC0 = "p0/m0/s0/e1/acc0";

describe("setAccidentalOnEvent", () => {
  it("changes only the selected note in a chord", () => {
    const chord = event("chord", [note("C", 4), note("E", 4), note("G", 4)]);

    expect(setAccidentalOnEvent(chord, 1, "sharp")).toBe(true);

    expect(chord.notes!.map((chordNote) => chordNote.pitch.alter)).toEqual([undefined, 1, undefined]);
  });

  it("changes every chord note when the whole event is selected", () => {
    const chord = event("chord", [note("C", 4), note("E", 4), note("G", 4)]);

    expect(setAccidentalOnEvent(chord, undefined, "flat")).toBe(true);

    expect(chord.notes!.map((chordNote) => chordNote.pitch.alter)).toEqual([-1, -1, -1]);
  });
});

describe("isAccidentalId", () => {
  it("recognises the engine's accidental ids and nothing else", () => {
    expect(isAccidentalId("p0/m0/s0/e1/acc0")).toBe(true);
    expect(isAccidentalId("p0/m0/s0/e1/acc12")).toBe(true);
    expect(isAccidentalId("p0/m0/s0/e1/n0")).toBe(false);
    expect(isAccidentalId("p0/m0/s0/e1")).toBe(false);
    expect(isAccidentalId("p0/m0/s0/e1/art0")).toBe(false);
  });
});

describe("prevailingAlteration", () => {
  it("falls back to the key signature", () => {
    // Two sharps: F# and C#.
    const score = makeScore([event("e1", [note("F", 4, 1)])], 2);
    const loc = resolveEventLocation("p0/m0/s0/e1", score)!;
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(prevailingAlteration(score, loc, target)).toBe(1);
  });

  it("returns 0 for a step the key signature leaves alone", () => {
    const score = makeScore([event("e1", [note("G", 4, 1)])], 2);
    const loc = resolveEventLocation("p0/m0/s0/e1", score)!;
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(prevailingAlteration(score, loc, target)).toBe(0);
  });

  it("prefers an earlier accidental in the same measure over the key signature", () => {
    const score = makeScore([event("e1", [note("B", 4, -1)]), event("e2", [note("B", 4, 0)])]);
    const loc = resolveEventLocation("p0/m0/s0/e2", score)!;
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[1] as NoteEvent).notes![0]!;
    expect(prevailingAlteration(score, loc, target)).toBe(-1);
  });

  it("ignores an accidental in a different octave", () => {
    const score = makeScore([event("e1", [note("B", 3, -1)]), event("e2", [note("B", 4, 0)])]);
    const loc = resolveEventLocation("p0/m0/s0/e2", score)!;
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[1] as NoteEvent).notes![0]!;
    expect(prevailingAlteration(score, loc, target)).toBe(0);
  });

  it("ignores accidentals written later in the measure", () => {
    const score = makeScore([event("e1", [note("B", 4, 0)]), event("e2", [note("B", 4, -1)])]);
    const loc = resolveEventLocation("p0/m0/s0/e1", score)!;
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(prevailingAlteration(score, loc, target)).toBe(0);
  });

  it("inherits the key signature from an earlier measure", () => {
    const score = makeScore([event("e1", [note("F", 4, 1)])], 3);
    score.global.measures.push({ time: { count: 4, unit: 4 } });
    score.parts[0]!.measures.push({ sequences: [{ content: [event("e2", [note("F", 4, 1)])] }] } as never);
    const loc = resolveEventLocation("p0/m1/s0/e2", score)!;
    const target = (score.parts[0]!.measures[1]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(prevailingAlteration(score, loc, target)).toBe(1);
  });
});

describe("prevailingAlterationAtPosition", () => {
  it("inherits an earlier accidental on the same pitch in the bar", () => {
    const score = makeScore([event("e1", [note("F", 4, 1)]), event("e2", [note("G", 4)])]);

    expect(prevailingAlterationAtPosition(score, 0, 0, 1, { step: "F", octave: 4 })).toBe(1);
  });

  it("ignores accidentals at or after the insertion beat", () => {
    const score = makeScore([event("e1", [note("F", 4, 1)])]);

    expect(prevailingAlterationAtPosition(score, 0, 0, 0, { step: "F", octave: 4 })).toBe(0);
  });

  it("inherits from an earlier onset in another voice", () => {
    const score = makeScore([event("e1", [note("G", 4)])]);
    score.parts[0]!.measures[0]!.sequences.push({
      content: [event("lower", [note("F", 4, -1)])],
    });

    expect(prevailingAlterationAtPosition(score, 0, 0, 1, { step: "F", octave: 4 })).toBe(-1);
  });
});

describe("removeAccidental", () => {
  it("respells the note to the key signature's alteration", () => {
    // Key of D (F#, C#); the note is written F natural, so it shows a natural.
    const score = makeScore([event("e1", [note("F", 4, 0)])], 2);
    expect(removeAccidental(score, ACC0)).not.toBeNull();
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(target.pitch.alter).toBe(1);
  });

  it("drops the alteration entirely when the default is natural", () => {
    const score = makeScore([event("e1", [note("C", 4, 1)])]);
    expect(removeAccidental(score, ACC0)).not.toBeNull();
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(target.pitch.alter).toBeUndefined();
    expect("alter" in target.pitch).toBe(false);
  });

  it("respells to an earlier accidental in the same measure", () => {
    const score = makeScore([event("e0", [note("B", 4, -1)]), event("e1", [note("B", 4, 0)])]);
    expect(removeAccidental(score, ACC0)).not.toBeNull();
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[1] as NoteEvent).notes![0]!;
    expect(target.pitch.alter).toBe(-1);
  });

  it("only drops the directive for a courtesy accidental, leaving the pitch alone", () => {
    const score = makeScore([
      event("e1", [note("C", 4, undefined, { accidentalDisplay: { show: true, force: true } })]),
    ]);
    expect(removeAccidental(score, ACC0)).not.toBeNull();
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(target.pitch.alter).toBeUndefined();
    expect(target.accidentalDisplay).toBeUndefined();
  });

  it("clears the display directive when respelling too", () => {
    const score = makeScore([event("e1", [note("C", 4, 1, { accidentalDisplay: { show: true } })])]);
    expect(removeAccidental(score, ACC0)).not.toBeNull();
    const target = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes![0]!;
    expect(target.pitch.alter).toBeUndefined();
    expect(target.accidentalDisplay).toBeUndefined();
  });

  it("targets the right note of a chord", () => {
    const score = makeScore([event("e1", [note("C", 4), note("E", 4, 1), note("G", 4)])]);
    expect(removeAccidental(score, "p0/m0/s0/e1/acc1")).not.toBeNull();
    const notes = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent).notes!;
    expect(notes[1]!.pitch.alter).toBeUndefined();
    expect(notes[0]!.pitch.step).toBe("C");
    expect(notes[2]!.pitch.step).toBe("G");
  });

  it("declines when there is no accidental to remove", () => {
    const score = makeScore([event("e1", [note("C", 4)])]);
    expect(removeAccidental(score, ACC0)).toBeNull();
  });

  it("declines on ids that are not accidentals", () => {
    const score = makeScore([event("e1", [note("C", 4, 1)])]);
    expect(removeAccidental(score, "p0/m0/s0/e1/n0")).toBeNull();
  });
});

describe("computeDeleteSelection — accidentals", () => {
  it("respells the note instead of replacing the event with a rest", () => {
    const score = makeScore([event("e1", [note("C", 4, 1)])]);
    const result = computeDeleteSelection(score, { kind: "single", elementId: ACC0 } as never);

    expect(result.kind).toBe("single");
    const events = (result as { score: Score }).score.parts[0]!.measures[0]!.sequences[0]!.content;
    const ev = events[0] as NoteEvent;
    expect(ev.notes).toHaveLength(1);
    expect(ev.notes![0]!.pitch.alter).toBeUndefined();
    expect(ev.rest).toBeUndefined();
  });

  it("clears the selection, since the accidental it pointed at is gone", () => {
    const score = makeScore([event("e1", [note("C", 4, 1)])]);
    const result = computeDeleteSelection(score, { kind: "single", elementId: ACC0 } as never);
    expect((result as { nextSelection: { kind: string } }).nextSelection.kind).toBe("clear");
  });

  it("is a no-op when the note carries no accidental", () => {
    const score = makeScore([event("e1", [note("C", 4)])]);
    expect(computeDeleteSelection(score, { kind: "single", elementId: ACC0 } as never).kind).toBe("noop");
  });

  it("still deletes a whole note when the notehead is selected", () => {
    const score = makeScore([event("e1", [note("C", 4, 1)])]);
    const result = computeDeleteSelection(score, { kind: "single", elementId: "p0/m0/s0/e1/n0" } as never);
    const sequence = (result as { score: Score }).score.parts[0]!.measures[0]!.sequences[0]!;
    expect(sequence.content).toEqual([]);
    expect(sequence.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
  });
});

// ═══════════════════════════════════════════
// The keyboard Delete path (what actually runs when the user presses Delete)
// ═══════════════════════════════════════════

function makeCtx(
  score: Score,
  selection: Selection,
): { ctx: KeyboardHandlerContext; latest: () => Score; selectionCalls: () => string[] } {
  let current = score;
  const calls: string[] = [];
  const ctx = {
    getScore: () => current,
    getSelection: () => selection,
    updateScore: (next: Score) => {
      current = next;
    },
    selectElement: (id: string) => {
      calls.push(`select:${id}`);
    },
    clearSelection: () => {
      calls.push("clear");
    },
  } as unknown as KeyboardHandlerContext;
  return { ctx, latest: () => current, selectionCalls: () => calls };
}

const noopEvent = { preventDefault() {} } as unknown as KeyboardEvent;

describe("handleDelete — accidentals", () => {
  it("respells the note instead of blanking the event", () => {
    const sel: Selection = { kind: "single", elementId: ACC0 };
    const { ctx, latest } = makeCtx(makeScore([event("e1", [note("C", 4, 1)])]), sel);
    handleDelete(noopEvent, false, ctx);

    const ev = latest().parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(ev.rest).toBeUndefined();
    expect(ev.notes).toHaveLength(1);
    expect(ev.notes![0]!.pitch.alter).toBeUndefined();
  });

  it("restores the key signature alteration", () => {
    // D major: F is sharp, so a written F natural reverts to F sharp.
    const sel: Selection = { kind: "single", elementId: ACC0 };
    const { ctx, latest } = makeCtx(makeScore([event("e1", [note("F", 4, 0)])], 2), sel);
    handleDelete(noopEvent, false, ctx);

    const ev = latest().parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(ev.notes![0]!.pitch.alter).toBe(1);
  });

  it("clears the selection rather than falling back to the note", () => {
    const sel: Selection = { kind: "single", elementId: ACC0 };
    const { ctx, selectionCalls } = makeCtx(makeScore([event("e1", [note("C", 4, 1)])]), sel);
    handleDelete(noopEvent, false, ctx);
    expect(selectionCalls()).toEqual(["clear"]);
  });

  it("still blanks the event when the notehead is selected", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/e1/n0" };
    const { ctx, latest } = makeCtx(makeScore([event("e1", [note("C", 4, 1)])]), sel);
    handleDelete(noopEvent, false, ctx);

    const sequence = latest().parts[0]!.measures[0]!.sequences[0]!;
    expect(sequence.content).toEqual([]);
    expect(sequence.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
  });

  it("does not touch the score when there is no accidental to remove", () => {
    const sel: Selection = { kind: "single", elementId: ACC0 };
    const { ctx, latest, selectionCalls } = makeCtx(makeScore([event("e1", [note("C", 4)])]), sel);
    handleDelete(noopEvent, false, ctx);

    const ev = latest().parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(ev.rest).toBeUndefined();
    expect(ev.notes).toHaveLength(1);
    // Nothing was deleted, so the selection stays where the user put it.
    expect(selectionCalls()).toEqual([]);
  });
});

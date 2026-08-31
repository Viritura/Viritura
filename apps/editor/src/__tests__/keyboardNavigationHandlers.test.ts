import { describe, expect, it, vi } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { buildNavigationIndex } from "../navigation/NavigationIndex";
import { handleArrowLeftRight, handleHomeEnd } from "../keyboard/navigationHandlers";
import { handleArrowUpDown } from "../keyboard/normalModeHandlers";
import { applyArrowTranspose } from "../keyboard/noteInputArrows";
import type { KeyboardHandlerContext } from "../keyboard/types";

function note(id: string, step: "C" | "D" = "C"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ pitch: { step, octave: 4 } }],
  };
}

function scoreWithTempo(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ tempos: [{ position: 0, bpm: 120 }] }] },
    parts: [
      {
        id: "part-1",
        name: "Piano",
        measures: [{ sequences: [{ content: [note("ev0"), note("ev1", "D")] }] }],
      },
    ],
  };
}

function keyboardEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...init });
}

describe("keyboard navigation handlers", () => {
  it("navigates right from a clicked notehead using its parent event", () => {
    const score = scoreWithTempo();
    const selectElement = vi.fn();
    const ctx = {
      getNavIndex: () => buildNavigationIndex(score),
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0/n0" }),
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleArrowLeftRight(keyboardEvent("ArrowRight"), false, ctx);

    expect(selectElement).toHaveBeenCalledWith("p0/m0/s0/ev1");
  });

  it("jumps to the score edge from a clicked notehead", () => {
    const score = scoreWithTempo();
    const selectElement = vi.fn();
    const ctx = {
      getNavIndex: () => buildNavigationIndex(score),
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0/n0" }),
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleHomeEnd(keyboardEvent("End"), ctx);

    expect(selectElement).toHaveBeenCalledWith("p0/m0/s0/ev1");
  });

  it("navigates to an adjacent staff from a clicked notehead", () => {
    const score = scoreWithTempo();
    score.parts.push({
      id: "part-2",
      name: "Cello",
      measures: [{ sequences: [{ content: [note("ev0")] }] }],
    });
    const selectElement = vi.fn();
    const ctx = {
      getScore: () => score,
      getNavIndex: () => buildNavigationIndex(score),
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0/n0" }),
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowDown"), false, ctx);

    expect(selectElement).toHaveBeenCalledWith("p1/m0/s0/ev0");
  });

  it("extends the selection to an adjacent staff with Shift+Down", () => {
    const score = scoreWithTempo();
    score.parts.push({
      id: "part-2",
      name: "Cello",
      measures: [{ sequences: [{ content: [note("ev0")] }] }],
    });
    const extendSelection = vi.fn();
    const ctx = {
      getScore: () => score,
      getNavIndex: () => buildNavigationIndex(score),
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0/n0" }),
      extendSelection,
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowDown", { shiftKey: true }), false, ctx);

    expect(extendSelection).toHaveBeenCalledWith("p1/m0/s0/ev0");
  });

  it("transposes a note diatonically with Alt+Up", () => {
    let score = scoreWithTempo();
    const selectElement = vi.fn();
    const ctx = {
      getScore: () => score,
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0" }),
      getNavIndex: () => buildNavigationIndex(score),
      updateScore: (next: Score) => {
        score = next;
      },
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowUp", { altKey: true }), false, ctx);

    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.notes![0]!.pitch).toMatchObject({ step: "D", octave: 4 });
    expect(event.notes![0]!.pitch.alter ?? 0).toBe(0);
    expect(selectElement).not.toHaveBeenCalled();
  });

  it("transposes a note chromatically with Alt+Shift+Up", () => {
    let score = scoreWithTempo();
    const ctx = {
      getScore: () => score,
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0" }),
      updateScore: (next: Score) => {
        score = next;
      },
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowUp", { altKey: true, shiftKey: true }), false, ctx);

    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.notes![0]!.pitch).toMatchObject({ step: "C", alter: 1, octave: 4 });
  });

  it("transposes a note by octave with Mod+Alt+Up", () => {
    let score = scoreWithTempo();
    const ctx = {
      getScore: () => score,
      getSelection: () => ({ kind: "single", elementId: "p0/m0/s0/ev0" }),
      updateScore: (next: Score) => {
        score = next;
      },
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowUp", { ctrlKey: true, altKey: true }), true, ctx);

    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.notes![0]!.pitch).toMatchObject({ step: "C", octave: 5 });
  });

  it("transposes every note in a multi-selection by octave with Mod+Alt+Up", () => {
    let score = scoreWithTempo();
    const ctx = {
      getScore: () => score,
      getSelection: () => ({
        kind: "multi",
        elementIds: ["p0/m0/s0/ev0", "p0/m0/s0/ev1"],
      }),
      updateScore: (next: Score) => {
        score = next;
      },
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowUp", { ctrlKey: true, altKey: true }), true, ctx);

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content as NoteEvent[];
    expect(content[0]!.notes![0]!.pitch).toMatchObject({ step: "C", octave: 5 });
    expect(content[1]!.notes![0]!.pitch).toMatchObject({ step: "D", octave: 5 });
  });
});

describe("note-input arrow transposition", () => {
  it.each([
    {
      name: "diatonically with Alt+Up",
      event: { altKey: true },
      expected: { step: "D", alter: 0, octave: 4 },
    },
    {
      name: "chromatically with Alt+Shift+Up",
      event: { altKey: true, shiftKey: true },
      expected: { step: "C", alter: 1, octave: 4 },
    },
    {
      name: "by octave with Mod+Alt+Up",
      event: { ctrlKey: true, altKey: true },
      expected: { step: "C", alter: 0, octave: 5 },
    },
  ])("transposes the entered note $name", ({ event, expected }) => {
    let score = scoreWithTempo();
    const ctx = {
      updateScore: (next: Score) => {
        score = next;
      },
      setLastPitch: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    applyArrowTranspose(
      keyboardEvent("ArrowUp", event),
      ctx,
      score,
      { partIndex: 0, staffIndex: 0, measureIndex: 0, beatPosition: 0 },
      0,
      { measureIndex: 0, eventIndex: 0 },
    );

    const transposed = score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect({
      ...transposed.notes![0]!.pitch,
      alter: transposed.notes![0]!.pitch.alter ?? 0,
    }).toMatchObject(expected);
  });
});

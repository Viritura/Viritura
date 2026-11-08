import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent, PartMeasure, Score } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { handleDelete } from "../keyboard/normalModeDelete";
import { buildClipboardSelection } from "../clipboard/buildClipboardSelection";
import { applyCut, cutToClipboard } from "../commands/clipboardCommands";

function note(id: string): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
  };
}

function measure(p: number, m: number): PartMeasure {
  return {
    sequences: [{ voice: "v1", staff: 1, content: [note(`n-${p}-${m}`)] }],
    dynamics: [
      { id: `dyn-${p}-${m}`, type: "immediate", position: { fraction: [0, 1] }, value: "f" },
      {
        id: `hairpin-${p}-${m}`,
        type: "gradual",
        position: { fraction: [0, 1] },
        end: { measure: `m${m}`, position: { fraction: [1, 4] } },
        wedgeType: "increasing",
      },
    ],
    expressions: [{ text: [{ text: "dolce" }], position: { fraction: [0, 1] } }],
    pedals: [
      { type: "sustain", position: { fraction: [0, 1] }, end: { measure: `m${m}`, position: { fraction: [1, 4] } } },
    ],
    ottavas: [{ value: 1, position: { fraction: [0, 1] }, end: { measure: `m${m}`, position: { fraction: [1, 4] } } }],
  };
}

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: 4 }, (_, m) => ({
        id: `m${m}`,
        time: { count: 4, unit: 4 },
        key: { fifths: 1 },
      })),
    },
    parts: Array.from({ length: 3 }, (_, p) => ({
      id: `part-${p}`,
      measures: Array.from({ length: 4 }, (_, m) => measure(p, m)),
    })),
  };
}

const bars: Extract<Selection, { kind: "measure" }> = {
  kind: "measure",
  startPartIndex: 1,
  endPartIndex: 0,
  startStaffIndex: 1,
  endStaffIndex: 0,
  startMeasure: 2,
  endMeasure: 1,
};

function expectClearedRectangle(result: Score, original: Score): void {
  expect(result.global).toEqual(original.global);
  expect(result.parts).toHaveLength(original.parts.length);
  for (const [p, part] of result.parts.entries()) {
    expect(part.measures).toHaveLength(4);
    for (const [m, current] of part.measures.entries()) {
      if (p > 1 || m < 1 || m > 2) {
        expect(current).toEqual(original.parts[p]!.measures[m]);
        continue;
      }
      expect(current.sequences).toEqual([
        { voice: "v1", staff: 1, content: [], fullMeasure: { visualDuration: { base: "whole" } } },
      ]);
      for (const key of ["dynamics", "expressions", "pedals", "ottavas", "measureRepeat"] as const) {
        expect(current[key]).toBeUndefined();
      }
    }
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("bar content deletion and cutting", () => {
  it("menu Delete clears reversed multi-bar/multi-part selections without mutating the source", () => {
    const score = makeScore();
    const original = structuredClone(score);
    const result = computeDeleteSelection(score, bars);
    expect(result.kind).toBe("measure");
    if (result.kind !== "measure") return;
    expect(result.score).not.toBe(score);
    expectClearedRectangle(result.score, original);
    expect(score).toEqual(original);
  });

  it.each(["Delete", "Backspace"])("%s matches menu Delete and retains the bar selection", (key) => {
    const score = makeScore();
    const updateScore = vi.fn();
    const clearSelection = vi.fn();
    const ctx = {
      getScore: () => score,
      getSelection: () => bars,
      updateScore,
      clearSelection,
    } as unknown as KeyboardHandlerContext;
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    handleDelete(event, false, ctx);
    expect(event.defaultPrevented).toBe(true);
    expect(updateScore).toHaveBeenCalledOnce();
    expectClearedRectangle(updateScore.mock.calls[0]![0], score);
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it("cuts all selected bars while retaining copied dynamics and untouched source content", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => undefined) } });
    const score = makeScore();
    const original = structuredClone(score);
    const selection = buildClipboardSelection(score, bars)!;
    const cut = await cutToClipboard(selection);
    expect(cut).not.toBeNull();
    expect(selection.tracks?.flatMap((track) => track.dynamics ?? [])).toHaveLength(8);
    const result = applyCut(score, cut!);
    expectClearedRectangle(result, original);
    expect(score).toEqual(original);
  });

  it("clears containers, grace notes, spaces, and measure repeats across every selected voice", async () => {
    const score = makeScore();
    const selected = score.parts[0]!.measures[1]!;
    selected.measureRepeat = { number: 1 };
    selected.sequences[0]!.content = [
      { type: "grace", content: [note("grace")] },
      {
        type: "tuplet",
        inner: { duration: { base: "eighth" }, multiple: 3 },
        outer: { duration: { base: "quarter" }, multiple: 1 },
        content: ["a", "b", "c"].map((id) => ({ ...note(id), duration: { base: "eighth" } })),
      },
      { type: "space", duration: { base: "quarter" } },
    ];
    selected.sequences.push({
      voice: "v2",
      content: [
        {
          type: "tremolo",
          marks: 2,
          outer: { duration: { base: "half" }, multiple: 1 },
          content: [note("tremolo-a"), note("tremolo-b")],
        },
      ],
    });
    const original = structuredClone(score);
    const deleted = computeDeleteSelection(score, bars);
    expect(deleted.kind).toBe("measure");
    if (deleted.kind !== "measure") return;
    const clipboard = buildClipboardSelection(score, bars)!;
    const result = applyCut(score, (await cutToClipboard(clipboard))!);
    expect(result).toEqual(deleted.score);
    const cleared = result.parts[0]!.measures[1]!;
    expect(cleared.sequences).toHaveLength(2);
    for (const sequence of cleared.sequences) {
      expect(sequence.content).toEqual([]);
      expect(sequence.fullMeasure).toEqual({ visualDuration: { base: "whole" } });
    }
    expect(cleared.measureRepeat).toBeUndefined();
    expect(cleared.dynamics).toBeUndefined();
    expect(result.parts[0]!.measures[0]).toEqual(original.parts[0]!.measures[0]);
    expect(score).toEqual(original);
  });

  it("clears annotations from silent bars without needing selected notes", () => {
    const score = makeScore();
    score.parts[0]!.measures[1]!.sequences[0]!.content = [];
    score.parts[0]!.measures[1]!.sequences[0]!.fullMeasure = { visualDuration: { base: "whole" } };
    const result = computeDeleteSelection(score, bars);
    expect(result.kind).toBe("measure");
    if (result.kind !== "measure") return;
    expectClearedRectangle(result.score, score);
  });

  it("removes a full-measure fermata while keeping rest placement and voice identity", () => {
    const score = makeScore();
    const sequence = score.parts[0]!.measures[1]!.sequences[0]!;
    sequence.content = [];
    sequence.fullMeasure = { visualDuration: { base: "whole" }, staffPosition: 2, fermata: {} };
    const result = computeDeleteSelection(score, bars);
    expect(result.kind).toBe("measure");
    if (result.kind !== "measure") return;
    expect(result.score.parts[0]!.measures[1]!.sequences[0]).toEqual({
      voice: "v1",
      staff: 1,
      content: [],
      fullMeasure: { visualDuration: { base: "whole" }, staffPosition: 2 },
    });
    expect(sequence.fullMeasure.fermata).toEqual({});
  });

  it("cuts full event ranges without leaving timed part annotations behind", async () => {
    const score = makeScore();
    const original = structuredClone(score);
    const clipboard = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "p0/m1/s0/n-0-1",
      endElementId: "p0/m2/s0/n-0-2",
    })!;
    const result = applyCut(score, (await cutToClipboard(clipboard))!);
    for (const m of [1, 2]) {
      const cleared = result.parts[0]!.measures[m]!;
      expect(cleared.sequences[0]!.content).toEqual([]);
      expect(cleared.dynamics).toBeUndefined();
      expect(cleared.expressions).toBeUndefined();
      expect(cleared.pedals).toBeUndefined();
      expect(cleared.ottavas).toBeUndefined();
    }
    expect(result.parts[1]).toEqual(original.parts[1]);
    expect(score).toEqual(original);
  });

  it("retains unrelated markings when cutting only part of a voice", async () => {
    const score = makeScore();
    score.parts[0]!.measures[1]!.sequences[0]!.content.push(note("unselected"));
    const clipboard = buildClipboardSelection(score, {
      kind: "single",
      elementId: "p0/m1/s0/n-0-1",
      elementType: "event",
    })!;
    const result = applyCut(score, (await cutToClipboard(clipboard))!);
    expect(result.parts[0]!.measures[1]!.dynamics).toEqual(score.parts[0]!.measures[1]!.dynamics);
    expect(result.parts[0]!.measures[1]!.sequences[0]!.content[1]).toEqual(note("unselected"));
  });
});

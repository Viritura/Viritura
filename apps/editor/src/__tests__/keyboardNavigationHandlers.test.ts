import { describe, expect, it, vi } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { buildNavigationIndex, getEntry } from "../navigation/NavigationIndex";
import { handleAnnotationNavigation, handleArrowLeftRight, handleHomeEnd } from "../keyboard/navigationHandlers";
import { buildEditorBindings, type EditorBindingConfig } from "../keyboard/editorBindings";
import { handleArrowUpDown } from "../keyboard/normalModeHandlers";
import { applyArrowTranspose } from "../keyboard/noteInputArrows";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { extractMeasureIndex } from "../score/ElementPath";
import { selectionReducer, type Selection } from "../store/selectionStore";
import { isSelectionIdValid } from "../store/useSelectionPruner";

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

describe("harmony annotation keyboard navigation", () => {
  function chordScore(): Score {
    const score = scoreWithTempo();
    score.global.measures[0]!.chordSymbols = [
      { position: { fraction: [0, 1] }, root: { step: "C" } },
      { position: { fraction: [1, 4] }, root: { step: "D" } },
      { position: { fraction: [1, 2] }, root: { step: "E" } },
    ];
    return score;
  }

  it.each([
    {
      layout: "canonical chord on the second source part",
      elementId: "m0/chord0",
      anchor: { partIndex: 1, staffIndex: 1, measureIndex: 0 },
    },
    {
      layout: "structural layout with a remapped staff",
      elementId: "m0/chord0/p0/staff8",
      anchor: { partIndex: 1, staffIndex: 7, localStaffIndex: 1, measureIndex: 0 },
    },
    {
      layout: "condensed staff",
      elementId: "m0/chord0/p0/staff1",
      anchor: { partIndex: 1, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
    },
    {
      layout: "expanded condensed source staff",
      elementId: "m0/chord0/p0/staff2",
      anchor: { partIndex: 1, staffIndex: 1, localStaffIndex: 0, measureIndex: 0, isExpansion: true },
    },
    {
      layout: "reordered source parts",
      elementId: "m0/chord0/p1/staff1",
      anchor: { partIndex: 0, staffIndex: 0, localStaffIndex: 0, measureIndex: 0 },
    },
  ])("uses the mapped source for opposite-side navigation in $layout", ({ elementId, anchor }) => {
    const score = chordScore();
    score.parts[0]!.id = "clarinet";
    score.parts.push({
      id: "piano",
      staves: (anchor.localStaffIndex ?? 0) + 1,
      measures: [{ sequences: [{ content: [note("piano-event")] }] }],
    });
    for (const part of score.parts) {
      part.measures[0]!.dynamics = [{ id: part.id!, type: "immediate", position: { fraction: [0, 1] }, value: "p" }];
    }
    const before = structuredClone(score);
    let selection: Selection = selectionReducer(
      { kind: "none" },
      { type: "SELECT_ELEMENT", elementId, measureAnchor: anchor },
    );
    const selectElement = vi.fn<KeyboardHandlerContext["selectElement"]>((elementId, measureAnchor) => {
      selection = selectionReducer(selection, { type: "SELECT_ELEMENT", elementId, measureAnchor });
    });
    const ctx = {
      getScore: () => score,
      getSelection: () => selection,
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowDown", { altKey: true }), false, ctx);

    const target = `p${anchor.partIndex}/m0/dyn${score.parts[anchor.partIndex]!.id}`;
    expect(selectElement).toHaveBeenCalledExactlyOnceWith(target, anchor);
    handleArrowUpDown(keyboardEvent("ArrowUp", { altKey: true }), false, ctx);
    expect(selection).toMatchObject({ elementId: "m0/chord0", measureAnchor: anchor });
    handleArrowUpDown(keyboardEvent("ArrowDown", { altKey: true }), false, ctx);
    expect(selectElement).toHaveBeenLastCalledWith(target, anchor);
    expect(score).toEqual(before);
  });

  it("retains an unanchored source dynamic's part when navigating through a global chord", () => {
    const score = chordScore();
    score.parts.push({
      id: "piano",
      measures: [
        {
          sequences: [{ content: [note("piano-event")] }],
          dynamics: [{ id: "piano", type: "immediate", position: { fraction: [0, 1] }, value: "p" }],
        },
      ],
    });
    let selection: Selection = selectionReducer(
      { kind: "none" },
      { type: "SELECT_ELEMENT", elementId: "p1/m0/dynpiano" },
    );
    const selectElement = vi.fn<KeyboardHandlerContext["selectElement"]>((elementId, measureAnchor) => {
      selection = selectionReducer(selection, { type: "SELECT_ELEMENT", elementId, measureAnchor });
    });
    const ctx = { getScore: () => score, getSelection: () => selection, selectElement } as KeyboardHandlerContext;
    handleArrowUpDown(keyboardEvent("ArrowUp", { altKey: true }), false, ctx);
    expect(selection).toMatchObject({ elementId: "m0/chord0", measureAnchor: { partIndex: 1 } });
    handleArrowUpDown(keyboardEvent("ArrowDown", { altKey: true }), false, ctx);
    expect(selection).toMatchObject({ elementId: "p1/m0/dynpiano", measureAnchor: { partIndex: 1 } });
  });

  it.each([1, 2])("retains an unanchored dynamic's source staff %s through a global chord", (staff) => {
    const score = chordScore();
    score.parts.push({
      id: "piano",
      staves: 2,
      measures: [
        {
          sequences: [{ staff, content: [note("piano-event")] }],
          dynamics: [{ id: "piano", staff, type: "immediate", position: { fraction: [0, 1] }, value: "p" }],
        },
      ],
    });
    let selection = selectionReducer({ kind: "none" }, { type: "SELECT_ELEMENT", elementId: "p1/m0/dynpiano" });
    const selectElement = vi.fn<KeyboardHandlerContext["selectElement"]>((elementId, measureAnchor) => {
      selection = selectionReducer(selection, { type: "SELECT_ELEMENT", elementId, measureAnchor });
    });
    const ctx = { getScore: () => score, getSelection: () => selection, selectElement } as KeyboardHandlerContext;

    handleArrowUpDown(keyboardEvent("ArrowUp", { altKey: true }), false, ctx);
    expect(selection).toMatchObject({
      elementId: "m0/chord0",
      measureAnchor: { partIndex: 1, sourceStaff: staff },
    });
    handleArrowUpDown(keyboardEvent("ArrowDown", { altKey: true }), false, ctx);
    expect(selection).toMatchObject({ elementId: "p1/m0/dynpiano" });
  });

  it.each([
    { direction: "next", bindingId: "normal.annotationNext", key: "Alt+ArrowRight", targetIndex: 1 },
    { direction: "previous", bindingId: "normal.annotationPrev", key: "Alt+ArrowLeft", targetIndex: 2 },
  ] as const)("routes $key through source-preserving selection", ({ bindingId, key, targetIndex }) => {
    const score = chordScore();
    const anchor = { partIndex: 3, staffIndex: 7, localStaffIndex: 1, measureIndex: 0, isExpansion: true };
    let selection: Selection = selectionReducer(
      { kind: "none" },
      { type: "SELECT_ELEMENT", elementId: "m0/chord0/p0/staff8", measureAnchor: anchor },
    );
    const selectElement = vi.fn<KeyboardHandlerContext["selectElement"]>((elementId, measureAnchor) => {
      selection = selectionReducer(selection, { type: "SELECT_ELEMENT", elementId, measureAnchor });
    });
    const ctx = {
      getScore: () => score,
      getSelection: () => selection,
      selectElement,
    } as KeyboardHandlerContext;
    const binding = buildEditorBindings({ ctx } as EditorBindingConfig).find((entry) => entry.id === bindingId)!;
    expect(binding.key).toBe(key);

    binding.handler(keyboardEvent(key.split("+")[1]!, { altKey: true }));

    const target = `m0/chord${targetIndex}/p0/staff8`;
    expect(selectElement).toHaveBeenCalledExactlyOnceWith(target, anchor);
    expect(selection).toMatchObject({ elementId: target, measureAnchor: anchor });
    expect(getEntry(buildNavigationIndex(score), target)?.elementId).toBe(`m0/chord${targetIndex}`);
    expect(isSelectionIdValid(target, score)).toBe(true);
    expect(extractMeasureIndex(target)).toBe(0);

    binding.handler(keyboardEvent(key.split("+")[1]!, { altKey: true }));
    expect(selection).toMatchObject({ measureAnchor: anchor });
  });

  it.each(["m0/chord0", "m0/chord0/p1/staff1", "m0/chord0/p4/staff2"])(
    "does not invent source metadata for unanchored %s",
    (elementId) => {
      const selectElement = vi.fn();
      const ctx = {
        getScore: chordScore,
        getSelection: () => selectionReducer({ kind: "none" }, { type: "SELECT_ELEMENT", elementId }),
        selectElement,
      } as unknown as KeyboardHandlerContext;

      handleAnnotationNavigation("next", ctx);

      expect(selectElement).toHaveBeenCalledExactlyOnceWith(elementId.replace("chord0", "chord1"));
    },
  );

  it("does not carry a staff anchor onto unrelated annotations", () => {
    const score = scoreWithTempo();
    score.global.measures[0]!.tempos!.push({ position: 1, bpm: 90 });
    const selectElement = vi.fn();
    const ctx = {
      getScore: () => score,
      getSelection: () => ({
        kind: "single",
        elementId: "m0/tempo0",
        measureAnchor: { partIndex: 1, staffIndex: 1, measureIndex: 0 },
      }),
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleAnnotationNavigation("next", ctx);

    expect(selectElement).toHaveBeenCalledExactlyOnceWith("m0/tempo1");
  });

  it.each(["m0/chord9/p1/staff1", "p0/m0/s0/ev0"])("ignores unresolved/non-annotation %s", (elementId) => {
    const selectElement = vi.fn();
    const ctx = {
      getScore: chordScore,
      getSelection: () => ({ kind: "single", elementId }),
      selectElement,
    } as unknown as KeyboardHandlerContext;

    handleAnnotationNavigation("next", ctx);

    expect(selectElement).not.toHaveBeenCalled();
  });
});

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

  it("stores written octave memory after transposing a Bb clarinet note", () => {
    let score = scoreWithTempo();
    score.scores = [{ name: "Written", useWritten: true }];
    score.parts[0]!.transposition = {
      interval: { halfSteps: 2, staffDistance: 1 },
    };
    score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch = {
      step: "B",
      octave: 3,
      alter: -1,
    };
    const setLastPitch = vi.fn();
    const ctx = {
      updateScore: (next: Score) => {
        score = next;
      },
      setLastPitch,
    } as unknown as KeyboardHandlerContext;

    applyArrowTranspose(
      keyboardEvent("ArrowUp", { ctrlKey: true, altKey: true }),
      ctx,
      score,
      { partIndex: 0, staffIndex: 0, measureIndex: 0, beatPosition: 0 },
      0,
      { measureIndex: 0, eventIndex: 0 },
    );

    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch).toEqual({
      step: "B",
      octave: 4,
      alter: -1,
    });
    expect(setLastPitch).toHaveBeenLastCalledWith({ step: "C", octave: 5 });
  });
});

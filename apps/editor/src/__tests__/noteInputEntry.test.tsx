import { act, cleanup, fireEvent, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Duration, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { TooltipPrimitives } from "@viritura/ui";
import { Toolbar } from "../components/Toolbar";
import { buildEditorBindings, type EditorBindingConfig } from "../keyboard/editorBindings";
import { DocumentProvider, useDocumentStoreApi } from "../store/DocumentContext";
import { noteInputActions, resetNoteInputStore, useNoteInput, useNoteInputStore } from "../store/noteInputStore";
import { resetSelectionStore, useSelectionStore, type Selection } from "../store/selectionStore";
import { useOverlayStore } from "../store/overlayStore";

function note(id: string, duration: Duration): NoteEvent {
  return { type: "event", id, duration, notes: [{ pitch: { step: "C", octave: 4 } }] };
}

function makeScore(content: SequenceContent[]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ measures: [{ sequences: [{ content }] }] }],
  };
}

function single(suffix: string): Selection {
  return { kind: "single", elementId: `p0/m0/s0/${suffix}`, elementType: "event" };
}

const ordinaryContent = [note("quarter", { base: "quarter" }), note("half", { base: "half", dots: 1 })];
const tuplet: SequenceContent = {
  type: "tuplet",
  inner: { multiple: 3, duration: { base: "eighth" } },
  outer: { multiple: 2, duration: { base: "eighth" } },
  content: [note("triplet", { base: "eighth", dots: 1 })],
};
const grace: SequenceContent = {
  type: "grace",
  content: [note("ornamental", { base: "16th", dots: 1 })],
};

interface EntryCase {
  name: string;
  selection: Selection;
  content?: SequenceContent[];
  duration: Duration;
}

const entryCases: EntryCase[] = [
  { name: "quarter clears previously chosen dots", selection: single("quarter"), duration: { base: "quarter" } },
  { name: "dotted half", selection: single("half"), duration: { base: "half", dots: 1 } },
  {
    name: "event ID with an annotation-like prefix",
    selection: single("chord-note"),
    content: [note("chord-note", { base: "half", dots: 1 })],
    duration: { base: "half", dots: 1 },
  },
  {
    name: "four augmentation dots",
    selection: single("four-dots"),
    content: [note("four-dots", { base: "eighth", dots: 4 })],
    duration: { base: "eighth", dots: 4 },
  },
  {
    name: "range uses its fixed start, not its end or score order",
    selection: { kind: "range", startElementId: "p0/m0/s0/half", endElementId: "p0/m0/s0/quarter" },
    duration: { base: "half", dots: 1 },
  },
  {
    name: "multi uses its first element, not its last or score order",
    selection: { kind: "multi", elementIds: ["p0/m0/s0/half", "p0/m0/s0/quarter"] },
    duration: { base: "half", dots: 1 },
  },
  {
    name: "chord notehead uses the owning event rhythm",
    selection: single("chord-note/n1"),
    content: [
      {
        ...note("chord-note", { base: "half", dots: 1 }),
        notes: [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }],
      },
    ],
    duration: { base: "half", dots: 1 },
  },
  {
    name: "tuplet child uses its written duration, not performed beats",
    selection: single("triplet/n0"),
    content: [tuplet],
    duration: { base: "eighth", dots: 1 },
  },
  {
    name: "flattened tuplet event ID",
    selection: single("e0"),
    content: [tuplet],
    duration: { base: "eighth", dots: 1 },
  },
  {
    name: "grace uses its own rhythm, not the principal",
    selection: single("principal/grace/ornamental"),
    content: [grace, note("principal", { base: "whole" })],
    duration: { base: "16th", dots: 1 },
  },
  {
    name: "grace nested in a tuplet",
    selection: single("principal/grace/ornamental"),
    content: [{ ...tuplet, content: [grace, note("principal", { base: "quarter" })] }],
    duration: { base: "16th", dots: 1 },
  },
];

const preserveCases: { name: string; selection: Selection }[] = [
  { name: "no selection", selection: { kind: "none" } },
  { name: "empty multi-selection", selection: { kind: "multi", elementIds: [] } },
  {
    name: "measure selection",
    selection: {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    },
  },
  { name: "stale note ID", selection: single("missing") },
  { name: "stale grace ID does not fall back to principal", selection: single("half/grace/missing") },
  { name: "selected rest", selection: single("rest") },
  { name: "note-attached annotation is not a selected note", selection: single("half/art0") },
  {
    name: "non-note multi anchor does not scan for another note",
    selection: { kind: "multi", elementIds: ["m0/time", "p0/m0/s0/half"] },
  },
];

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DocumentProvider>
      <TooltipPrimitives.Provider>
        {children}
        <Toolbar />
      </TooltipPrimitives.Provider>
    </DocumentProvider>
  );
}

function setup(entry: "N" | "toolbar", score: Score | null, selection: Selection) {
  const { result } = renderHook(() => ({ store: useDocumentStoreApi(), input: useNoteInput() }), { wrapper: Wrapper });
  act(() => {
    result.current.store.setState({ score, workingScore: score });
    useSelectionStore.setState({ selection });
    noteInputActions.setDuration("16th");
    noteInputActions.setDotCount(2);
  });
  const bindings = buildEditorBindings({
    ctx: {
      getScore: () => result.current.store.getState().workingScore,
      getSelection: () => useSelectionStore.getState().selection,
    },
    toggleNoteInput: result.current.input.toggleNoteInput,
  } as EditorBindingConfig);
  const binding = bindings.find((item) => item.id === "global.toggleNoteInput")!;
  expect(binding.key).toBe("N");
  const toggle = () => {
    act(() => {
      if (entry === "N") binding.handler(new KeyboardEvent("keydown", { key: "n" }));
      else fireEvent.click(screen.getByTestId("toolbar-note-input"));
    });
  };
  return { store: result.current.store, toggle };
}

beforeEach(() => {
  resetNoteInputStore();
  resetSelectionStore();
});

afterEach(() => {
  cleanup();
  resetNoteInputStore();
  resetSelectionStore();
  useOverlayStore.setState({ lyricMode: false, lyricState: null });
});

describe.each(["N", "toolbar"] as const)("Add Note entry via %s", (entry) => {
  it.each(entryCases)("inherits rhythm: $name", ({ selection, content = ordinaryContent, duration }) => {
    const score = makeScore(content);
    const original = structuredClone(score);
    const { store, toggle } = setup(entry, score, selection);
    const listener = vi.fn();
    const unsubscribe = useNoteInputStore.subscribe(listener);

    toggle();
    unsubscribe();

    expect(useNoteInputStore.getState()).toMatchObject({
      active: true,
      currentDuration: duration.base,
      dotCount: duration.dots ?? 0,
      selectedDotCount: duration.dots || 2,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().workingScore).toBe(score);
    expect(score).toEqual(original);
    expect(store.getState().dirty).toBe(false);
    expect(useSelectionStore.getState().selection).toEqual(selection);
  });

  it.each(preserveCases)("preserves chosen rhythm: $name", ({ selection }) => {
    const { toggle } = setup(
      entry,
      makeScore([...ordinaryContent, { type: "event", id: "rest", duration: { base: "whole" }, rest: {} }]),
      selection,
    );

    toggle();

    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "16th", dotCount: 2 });
  });

  it("preserves rhythm without a loaded score", () => {
    const { toggle } = setup(entry, null, single("half"));
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "16th", dotCount: 2 });
  });

  it("reads the latest working score and selection at entry", () => {
    const { store, toggle } = setup(entry, makeScore(ordinaryContent), single("quarter"));
    act(() => {
      store.setState({ workingScore: makeScore([note("latest", { base: "whole", dots: 3 })]) });
      useSelectionStore.setState({ selection: single("latest") });
    });

    toggle();

    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "whole", dotCount: 3 });
  });

  it("does not overwrite chosen rhythm on selection changes or exit, and inherits again on reentry", () => {
    const { toggle } = setup(entry, makeScore(ordinaryContent), single("half"));
    toggle();
    act(() => {
      noteInputActions.setDuration("whole");
      noteInputActions.setDotCount(3);
      useSelectionStore.setState({ selection: single("quarter") });
    });
    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "whole", dotCount: 3 });

    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({ active: false, currentDuration: "whole", dotCount: 3 });
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "quarter", dotCount: 0 });
  });

  it("updates dot picker memory without inheriting unrelated input modes", () => {
    const { toggle } = setup(entry, makeScore(ordinaryContent), single("half"));
    act(() => {
      noteInputActions.setAccidental("sharp");
      noteInputActions.setVoice(2);
      noteInputActions.setGraceType("appoggiatura");
      noteInputActions.setChordLock(true);
      useOverlayStore.setState({ lyricMode: true, lyricState: { elementId: "p0/m0/s0/half", lineId: "1" } });
    });
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({
      currentAccidental: "sharp",
      currentVoice: 2,
      currentGraceType: "appoggiatura",
      chordLock: true,
      dotCount: 1,
      selectedDotCount: 1,
    });
    expect(useOverlayStore.getState()).toMatchObject({ lyricMode: false, lyricState: null });
    act(() => {
      noteInputActions.toggleDot();
      noteInputActions.toggleDot();
    });
    expect(useNoteInputStore.getState().dotCount).toBe(1);
  });
});

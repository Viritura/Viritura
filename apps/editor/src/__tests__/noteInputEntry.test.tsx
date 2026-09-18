import { act, cleanup, fireEvent, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Duration, NoteEvent, Score, SequenceContent, TimeSignature } from "@viritura/core";
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

function rest(id: string, duration: Duration): NoteEvent {
  return { type: "event", id, duration, rest: {} };
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

function selectedRest(suffix = "rest"): Selection {
  return { kind: "single", elementId: `p0/m0/s0/${suffix}`, elementType: "rest" };
}

function fullMeasureScore(time: TimeSignature): Score {
  const score = makeScore([]);
  score.global.measures = [{ time }, {}];
  score.parts[0]!.measures = Array.from({ length: 2 }, () => ({
    sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
  }));
  return score;
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
    name: "quarter rest clears previously chosen dots",
    selection: selectedRest(),
    content: [rest("rest", { base: "quarter" })],
    duration: { base: "quarter" },
  },
  {
    name: "dotted rest",
    selection: selectedRest(),
    content: [rest("rest", { base: "half", dots: 1 })],
    duration: { base: "half", dots: 1 },
  },
  {
    name: "rest with four dots",
    selection: selectedRest(),
    content: [rest("rest", { base: "eighth", dots: 4 })],
    duration: { base: "eighth", dots: 4 },
  },
  {
    name: "flattened rest ID",
    selection: selectedRest("e0"),
    content: [rest("rest", { base: "eighth" })],
    duration: { base: "eighth" },
  },
  {
    name: "tuplet rest uses its written rhythm",
    selection: selectedRest(),
    content: [{ ...tuplet, content: [rest("rest", { base: "eighth" })] }],
    duration: { base: "eighth" },
  },
  {
    name: "range anchored on a rest",
    selection: { kind: "range", startElementId: "p0/m0/s0/rest", endElementId: "p0/m0/s0/quarter" },
    content: [rest("rest", { base: "half", dots: 1 }), ...ordinaryContent],
    duration: { base: "half", dots: 1 },
  },
  {
    name: "multi anchored on a rest",
    selection: { kind: "multi", elementIds: ["p0/m0/s0/rest", "p0/m0/s0/quarter"] },
    content: [rest("rest", { base: "half", dots: 1 }), ...ordinaryContent],
    duration: { base: "half", dots: 1 },
  },
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
  { name: "rest-attached annotation", selection: selectedRest("rest/ferm") },
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
      isRest: false,
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

  it.each([
    { count: 4, unit: 4, duration: { base: "whole" } },
    { count: 6, unit: 8, duration: { base: "half", dots: 1 } },
    { count: 7, unit: 8, duration: { base: "half", dots: 2 } },
    { count: 15, unit: 16, duration: { base: "half", dots: 3 } },
    { count: 31, unit: 32, duration: { base: "half", dots: 4 } },
  ] as const)("inherits the actual full-measure rest length in $count/$unit", ({ count, unit, duration }) => {
    const score = fullMeasureScore({ count, unit });
    const original = structuredClone(score);
    // The second bar inherits its meter; use the synthetic render ID.
    const selection: Selection = { kind: "single", elementId: "p0/m1/s0/__auto_m1_v0_e0", elementType: "rest" };
    const { store, toggle } = setup(entry, score, selection);
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({
      active: true,
      isRest: false,
      currentDuration: duration.base,
      dotCount: "dots" in duration ? duration.dots : 0,
    });
    expect(store.getState().workingScore).toBe(score);
    expect(store.getState().dirty).toBe(false);
    expect(score).toEqual(original);
  });

  it.each([
    { count: 5, unit: 8 },
    { count: 5, unit: 2 },
    { count: 63, unit: 64 },
  ])("preserves chosen rhythm for an unrepresentable full-measure rest in $count/$unit", (time) => {
    const score = fullMeasureScore(time);
    const original = structuredClone(score);
    const { toggle } = setup(entry, score, selectedRest("e0"));
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({
      active: true,
      currentDuration: "16th",
      dotCount: 2,
      isRest: false,
    });
    expect(score).toEqual(original);
  });

  it("inherits a full-measure rest selected with the legacy event ID", () => {
    const { toggle } = setup(entry, fullMeasureScore({ count: 6, unit: 8 }), selectedRest("e0"));
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({
      active: true,
      currentDuration: "half",
      dotCount: 1,
      isRest: false,
    });
  });

  it.each([-1, 0.5, 5])("preserves chosen rhythm for an unsupported rest dot count: %s", (dots) => {
    const { toggle } = setup(entry, makeScore([rest("rest", { base: "quarter", dots })]), selectedRest());
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({
      active: true,
      currentDuration: "16th",
      dotCount: 2,
      isRest: false,
    });
  });

  it("keeps the default note rhythm without a selection", () => {
    const { toggle } = setup(entry, makeScore(ordinaryContent), { kind: "none" });
    act(() => resetNoteInputStore());
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({
      active: true,
      currentDuration: "quarter",
      dotCount: 0,
      isRest: false,
    });
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

  it.each(["note", "rest"])("does not overwrite chosen rhythm on %s selection changes or exit", (kind) => {
    const nextSelection = kind === "rest" ? selectedRest() : single("quarter");
    const { toggle } = setup(entry, makeScore([...ordinaryContent, rest("rest", { base: "quarter" })]), single("half"));
    toggle();
    act(() => {
      noteInputActions.setDuration("whole");
      noteInputActions.setDotCount(3);
      useSelectionStore.setState({ selection: nextSelection });
    });
    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "whole", dotCount: 3 });

    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({ active: false, currentDuration: "whole", dotCount: 3 });
    toggle();
    expect(useNoteInputStore.getState()).toMatchObject({ active: true, currentDuration: "quarter", dotCount: 0 });
  });

  it.each(["note", "rest"])("updates %s dot picker memory without inheriting unrelated input modes", (kind) => {
    const selection = kind === "rest" ? selectedRest() : single("half");
    const { toggle } = setup(
      entry,
      makeScore([...ordinaryContent, rest("rest", { base: "half", dots: 1 })]),
      selection,
    );
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
      isRest: false,
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

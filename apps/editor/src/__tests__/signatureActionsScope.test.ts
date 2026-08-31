import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Score, NoteEvent, Step, Octave } from "@viritura/core";
import { setTimeSignature, setKeySignature, setEnding } from "@viritura/core";
import { useSignatureActions } from "../app/useSignatureActions";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";

function note(id: string, step: Step = "C", octave: Octave = 4): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, notes: [{ pitch: { step, octave } }] };
}

// 1 part × 3 measures, one quarter note per measure.
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }, { id: "m1" }, { id: "m2" }] },
    parts: [
      {
        name: "Violin",
        measures: [
          { sequences: [{ content: [note("e0")] }] },
          { sequences: [{ content: [note("e1")] }] },
          { sequences: [{ content: [note("e2")] }] },
        ],
      },
    ],
  };
}

function setup(score: Score, selection: SelectionState) {
  const updateScore = vi.fn();
  const store = { getState: () => ({ score }) } as unknown as DocumentStore;
  const { result } = renderHook(() => useSignatureActions({ store, selection, updateScore }));
  return { actions: result.current, updateScore };
}

describe("useSignatureActions — scope derivation via resolveSelectionScope", () => {
  it("applies a time signature at the start measure of a measure selection", () => {
    const score = makeScore();
    const sel: SelectionState = {
      kind: "measure",
      startMeasure: 1,
      endMeasure: 2,
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
    };
    const { actions, updateScore } = setup(score, sel);
    actions.handleSetTimeSignature({ count: 3, unit: 4 });
    expect(updateScore).toHaveBeenCalledWith(setTimeSignature(score, 1, { count: 3, unit: 4 }));
  });

  it("applies a key signature at the lowest measure of a multi selection", () => {
    const score = makeScore();
    const sel: SelectionState = { kind: "multi", elementIds: ["p0/m2/s0/e2", "p0/m1/s0/e1"] };
    const { actions, updateScore } = setup(score, sel);
    actions.handleSetKeySignature({ fifths: 2 });
    expect(updateScore).toHaveBeenCalledWith(setKeySignature(score, 1, { fifths: 2 }));
  });

  it("spans an ending across the full measure range of the selection", () => {
    const score = makeScore();
    const sel: SelectionState = {
      kind: "measure",
      startMeasure: 0,
      endMeasure: 2,
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
    };
    const { actions, updateScore } = setup(score, sel);
    actions.handleSetEnding({ numbers: [1], duration: 1 });
    // duration recomputed from the 3-measure span (0..2 → 3).
    expect(updateScore).toHaveBeenCalledWith(setEnding(score, 0, { numbers: [1], duration: 3 }));
  });

  it("no-ops index to 0 for an empty selection", () => {
    const score = makeScore();
    const { actions, updateScore } = setup(score, { kind: "none" });
    actions.handleSetTimeSignature({ count: 2, unit: 4 });
    expect(updateScore).toHaveBeenCalledWith(setTimeSignature(score, 0, { count: 2, unit: 4 }));
  });
});

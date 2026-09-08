import { renderHook } from "@testing-library/react";
import type { Score } from "@viritura/core";
import { describe, expect, it, vi } from "vitest";
import { useCursorOnNoteInputActivate } from "../app/useCursorOnNoteInputActivate";
import { createDocumentStore } from "../store/documentStore";
import { initialNoteInputState } from "../store/noteInputStore";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}, {}, {}] },
    parts: [
      {
        measures: [
          { sequences: [{ content: [] }] },
          { sequences: [{ content: [] }] },
          { sequences: [{ content: [] }] },
        ],
      },
    ],
  };
}

describe("useCursorOnNoteInputActivate", () => {
  it.each([
    {
      name: "measure selection",
      selection: {
        kind: "measure" as const,
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 1,
        endStaffIndex: 1,
        startLocalStaffIndex: 1,
        endLocalStaffIndex: 1,
        startMeasure: 1,
        endMeasure: 1,
      },
    },
    {
      name: "barline selection",
      selection: {
        kind: "single" as const,
        elementId: "m2/barline",
        elementType: "barline" as const,
        measureAnchor: { partIndex: 0, staffIndex: 1, localStaffIndex: 1, measureIndex: 1 },
      },
    },
  ])("places the cursor in the selected bar for a $name", ({ selection }) => {
    const store = createDocumentStore();
    store.setState({ score: makeScore() });
    const setCursor = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useCursorOnNoteInputActivate({
          store,
          noteInputState: { ...initialNoteInputState, active },
          selection,
          setCursor,
        }),
      { initialProps: { active: false } },
    );

    rerender({ active: true });

    expect(setCursor).toHaveBeenLastCalledWith({
      measureIndex: 1,
      beatPosition: 0,
      partIndex: 0,
      staffIndex: 1,
    });
  });

  it("places the cursor at the performed beat of an event inside a tuplet", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      { type: "event", id: "before", duration: { base: "quarter" }, rest: {} },
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content: [
          { type: "event", id: "triplet-1", duration: { base: "eighth" }, rest: {} },
          {
            type: "event",
            id: "triplet-2",
            duration: { base: "eighth" },
            notes: [{ pitch: { step: "C", octave: 4 } }],
          },
          { type: "event", id: "triplet-3", duration: { base: "eighth" }, rest: {} },
        ],
      },
      { type: "event", id: "after", duration: { base: "half" }, rest: {} },
    ];
    const store = createDocumentStore();
    store.setState({ score });
    const setCursor = vi.fn();
    const selection = {
      kind: "single" as const,
      elementId: "p0/m0/s0/triplet-2",
      elementType: "event" as const,
    };
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useCursorOnNoteInputActivate({
          store,
          noteInputState: { ...initialNoteInputState, active },
          selection,
          setCursor,
        }),
      { initialProps: { active: false } },
    );

    rerender({ active: true });

    expect(setCursor).toHaveBeenLastCalledWith({
      measureIndex: 0,
      beatPosition: 1 + 1 / 3,
      partIndex: 0,
      staffIndex: 0,
    });
  });
});

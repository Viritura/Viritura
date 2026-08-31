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
});

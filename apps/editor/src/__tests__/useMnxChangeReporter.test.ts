import { act, renderHook, waitFor } from "@testing-library/react";
import type { Score } from "@viritura/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMnxChangeReporter } from "../app/useMnxChangeReporter";
import { createDocumentStore } from "../store/documentStore";
import { noteInputActions, resetNoteInputStore } from "../store/noteInputStore";

function makeScore(step: "C" | "D"): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step, octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

afterEach(() => resetNoteInputStore());

describe("useMnxChangeReporter", () => {
  it("records cursor positions before and after an edit", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore("C"));
    const pushState = vi.fn();
    const before = { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 };
    const after = { measureIndex: 0, beatPosition: 1, partIndex: 0, staffIndex: 0 };
    noteInputActions.setCursor(before);
    renderHook(() => useMnxChangeReporter({ store, pushState }));

    act(() => {
      store.getState().updateScore(makeScore("D"));
      noteInputActions.setCursor(after);
    });

    await waitFor(() => {
      expect(pushState).toHaveBeenCalledWith(expect.any(String), "Edit", before, after);
    });
  });
});

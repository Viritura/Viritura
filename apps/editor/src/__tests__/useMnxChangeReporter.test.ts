import { act, renderHook, waitFor } from "@testing-library/react";
import type { Score } from "@viritura/core";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { parseMnx } from "@viritura/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMnxChangeReporter } from "../app/useMnxChangeReporter";
import { createDocumentStore } from "../store/documentStore";
import { createHistoryStore } from "../store/historyStore";
import { noteInputActions, resetNoteInputStore } from "../store/noteInputStore";
import { clearBreakInScore, insertBreakInScore } from "../score/ScoreMutations";

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

afterEach(() => {
  resetNoteInputStore();
  getGlobalPerfTracker().fastLayoutCallback = null;
});

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

  it("resets history when a different document is opened", async () => {
    const store = createDocumentStore();
    const pushState = vi.fn();
    const resetHistory = vi.fn();
    renderHook(() => useMnxChangeReporter({ store, pushState, resetHistory }));

    act(() => store.getState().loadScore(makeScore("C"), "opened.mnx"));

    await waitFor(() => expect(resetHistory).toHaveBeenCalledWith(store.getState().mnxJson));
    expect(pushState).not.toHaveBeenCalled();
  });

  it("does not reset or push history while restoring an undo snapshot", async () => {
    const store = createDocumentStore();
    store.getState().loadScore(makeScore("C"), "opened.mnx");
    const generation = store.getState().documentGeneration;
    const pushState = vi.fn();
    const resetHistory = vi.fn();
    renderHook(() => useMnxChangeReporter({ store, pushState, resetHistory }));

    act(() => store.getState().loadScore(makeScore("D"), undefined, undefined, true));

    await waitFor(() => expect(store.getState().mnxJson).toContain('"step":"D"'));
    expect(store.getState().documentGeneration).toBe(generation);
    expect(resetHistory).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("undoes a structural break before its asynchronous layout completes", async () => {
    const base = makeScore("C");
    base.global.measures = [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }];
    base.parts[0]!.measures.push({ sequences: [] });
    base.scores = [{ name: "Piano" }];
    const store = createDocumentStore();
    store.getState().loadScore(base);
    const history = createHistoryStore(store.getState().mnxJson, {
      current: (mnxJson) => {
        store.getState().loadScore(parseMnx(JSON.parse(mnxJson)), undefined, mnxJson, true);
      },
    });
    renderHook(() => useMnxChangeReporter({ store, pushState: history.getState().pushState }));

    let finishLayout: (() => void) | undefined;
    getGlobalPerfTracker().fastLayoutCallback = () =>
      new Promise<void>((resolve) => {
        finishLayout = resolve;
      });

    act(() => {
      store.getState().updateScore(insertBreakInScore(base, 0, "m2", "system"));
    });

    await waitFor(() => expect(history.getState().canUndo).toBe(true));
    expect(finishLayout).toBeDefined();

    act(() => {
      history.getState().undo();
    });
    expect(store.getState().workingScore?.scores?.[0]?.layoutBreaks).toBeUndefined();

    await act(async () => {
      finishLayout?.();
      await Promise.resolve();
    });
    expect(store.getState().workingScore?.scores?.[0]?.layoutBreaks).toBeUndefined();
  });

  it("restores a deleted page break before its asynchronous layout completes", async () => {
    const base = makeScore("C");
    base.global.measures = [{ id: "m1", time: { count: 4, unit: 4 } }, { id: "m2" }];
    base.parts[0]!.measures.push({ sequences: [] });
    base.scores = [{ name: "Piano", layoutBreaks: [{ measure: "m2", kind: "page" }] }];
    const store = createDocumentStore();
    store.getState().loadScore(base);
    const history = createHistoryStore(store.getState().mnxJson, {
      current: (mnxJson) => {
        store.getState().loadScore(parseMnx(JSON.parse(mnxJson)), undefined, mnxJson, true);
      },
    });
    renderHook(() => useMnxChangeReporter({ store, pushState: history.getState().pushState }));

    let finishLayout: (() => void) | undefined;
    getGlobalPerfTracker().fastLayoutCallback = () =>
      new Promise<void>((resolve) => {
        finishLayout = resolve;
      });

    act(() => {
      store.getState().updateScore(clearBreakInScore(base, 0, "m2"));
    });

    await waitFor(() => expect(history.getState().historySize).toBe(2));
    expect(store.getState().workingScore?.scores?.[0]?.layoutBreaks).toBeUndefined();

    act(() => {
      history.getState().undo();
    });
    expect(store.getState().workingScore?.scores?.[0]?.layoutBreaks).toEqual([{ measure: "m2", kind: "page" }]);

    await act(async () => {
      finishLayout?.();
      await Promise.resolve();
    });
    expect(store.getState().workingScore?.scores?.[0]?.layoutBreaks).toEqual([{ measure: "m2", kind: "page" }]);
  });
});

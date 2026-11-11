import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { useEditorMiscActions } from "./useEditorMiscActions";
import { createDocumentStore } from "../store/documentStore";
import { resetSelectionStore, useSelectionActions, useSelectionStore } from "../store/selectionStore";
import { removeMeasureRangeFromScore } from "../keyboard/normalModeDeleteHelpers";
import { createHistoryStore } from "../store/historyStore";
import { parseMnx } from "@viritura/format";
import { useMnxChangeReporter } from "./useMnxChangeReporter";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m0", time: { count: 3, unit: 4 }, key: { fifths: 2 } }, { id: "m1" }, { id: "m2" }],
    },
    parts: ["flute", "piano"].map((id) => ({
      id,
      name: id,
      measures: [0, 1, 2].map((index) => ({
        ...(index === 0 && { clefs: [{ clef: { sign: "G", line: 2 } }] }),
        sequences: [
          {
            content: [
              {
                type: "event",
                id: `${id}-${index}`,
                duration: { base: "quarter" },
                notes: [{ pitch: { step: "C", octave: 4 } }],
              },
            ],
          },
        ],
      })),
    })),
  };
}

function harness() {
  const store = createDocumentStore();
  const score = makeScore();
  store.setState({ score, workingScore: score });
  const updateScore = vi.fn<(next: Score) => void>();
  const clearSelection = vi.fn();
  const hook = renderHook(() => ({
    actions: useSelectionActions(),
    ...useEditorMiscActions({
      store,
      selection: { kind: "none" },
      updateScore,
      selectElement: vi.fn(),
      selectRange: vi.fn(),
      clearSelection,
      canvasRef: { current: null },
      currentZoom: 1,
    }),
  }));
  return { ...hook, score, store, updateScore, clearSelection };
}

beforeEach(() => {
  resetSelectionStore();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Delete Selection", () => {
  it("uses live selection and pending working score, not captured selection or published layout", () => {
    const { result, store, updateScore, score, clearSelection } = harness();
    const working = structuredClone(score);
    const event = working.parts[0]!.measures[0]!.sequences[0]!.content[0];
    if (event?.type !== "event") throw new Error("Expected event");
    event.fermata = {};
    event.ornament = "turn";
    store.setState({ workingScore: working });
    act(() => {
      result.current.actions.selectElement("p0/m0/s0/flute-0/ferm");
      result.current.handleDeleteSelection();
    });
    expect(updateScore).toHaveBeenCalledOnce();
    const next = updateScore.mock.calls[0]![0];
    expect(next.parts[0]!.measures[0]!.sequences[0]!.content[0]).toMatchObject({
      ornament: "turn",
      notes: event.notes,
    });
    expect(next.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("fermata");
    expect(event.fermata).toEqual({});
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it("does not commit or clear a stale target", () => {
    const { result, updateScore, clearSelection } = harness();
    act(() => {
      result.current.actions.selectElement("p0/m0/s0/missing/ferm");
      result.current.handleDeleteSelection();
    });
    expect(updateScore).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it("composes consecutive commands before the published layout catches up", () => {
    const { result, store, score, updateScore } = harness();
    const working = structuredClone(score);
    const event = working.parts[0]!.measures[0]!.sequences[0]!.content[0];
    if (event?.type !== "event") throw new Error("Expected event");
    event.fermata = {};
    event.markings = { ornaments: ["mordent"], accent: {} };
    store.setState({ workingScore: working });
    updateScore.mockImplementation((next) => store.setState({ workingScore: next }));
    act(() => {
      result.current.actions.selectElement("p0/m0/s0/flute-0/ferm");
      result.current.handleDeleteSelection();
      result.current.actions.selectElement("p0/m0/s0/flute-0/ornament");
      result.current.handleDeleteSelection();
    });
    expect(updateScore).toHaveBeenCalledTimes(2);
    const latest = store.getState().workingScore!.parts[0]!.measures[0]!.sequences[0]!.content[0];
    expect(latest).not.toHaveProperty("fermata");
    expect(latest).toMatchObject({ markings: { accent: {} }, notes: event.notes });
    expect(latest).not.toHaveProperty("markings.ornaments");
    expect(store.getState().score).toBe(score);
    expect(event.fermata).toEqual({});
    expect(event.markings.ornaments).toEqual(["mordent"]);
  });
});

describe("Swap Staff Contents", () => {
  it("uses the live bar selection in a single document update and keeps it selected", () => {
    const { result, updateScore, clearSelection, score } = harness();
    act(() => {
      result.current.actions.selectMeasure(0, 0, 0, 0);
      result.current.actions.extendMeasure(1, 1, 1, 0);
      result.current.handleSwapStaffContents();
    });
    expect(updateScore).toHaveBeenCalledOnce();
    const next = updateScore.mock.calls[0]![0];
    expect(next.parts[0]!.measures[0]!.sequences[0]!.content).toEqual(
      score.parts[1]!.measures[0]!.sequences[0]!.content,
    );
    expect(next.parts[1]!.measures[1]!.sequences[0]!.content).toEqual(
      score.parts[0]!.measures[1]!.sequences[0]!.content,
    );
    expect(next.parts[0]!.measures[2]).toEqual(score.parts[0]!.measures[2]);
    expect(clearSelection).not.toHaveBeenCalled();
    expect(useSelectionStore.getState().selection.kind).toBe("measure");
  });

  it("reports invalid or stale selections rather than changing music", () => {
    const { result, updateScore } = harness();
    act(() => result.current.handleSwapStaffContents());
    act(() => {
      result.current.actions.selectMeasure(0, 0, 0, 0);
      result.current.handleSwapStaffContents();
      result.current.actions.extendMeasure(1, 1, 10, 0);
      result.current.handleSwapStaffContents();
    });
    expect(toast.info).toHaveBeenCalledTimes(3);
    expect(updateScore).not.toHaveBeenCalled();
  });

  it("creates one undoable edit and restores the swap on redo", async () => {
    const store = createDocumentStore();
    const initial = makeScore();
    for (const part of initial.parts) {
      part.measures[0]!.clefs = [{ clef: { sign: "G", staffPosition: -2 } }];
    }
    store.getState().loadScore(initial);
    const initialMnx = store.getState().mnxJson;
    const history = createHistoryStore(initialMnx, {
      current: (mnxJson) => store.getState().loadScore(parseMnx(JSON.parse(mnxJson)), undefined, mnxJson, true),
    });
    const { result } = renderHook(() => {
      useMnxChangeReporter({ store, pushState: history.getState().pushState });
      return {
        actions: useSelectionActions(),
        ...useEditorMiscActions({
          store,
          selection: { kind: "none" },
          updateScore: store.getState().updateScore,
          selectElement: vi.fn(),
          selectRange: vi.fn(),
          clearSelection: vi.fn(),
          canvasRef: { current: null },
          currentZoom: 1,
        }),
      };
    });
    await act(async () => {
      result.current.actions.selectMeasure(0, 0, 0, 0);
      result.current.actions.extendMeasure(1, 1, 1, 0);
      result.current.handleSwapStaffContents();
    });
    const swapped = store.getState().mnxJson;
    expect(swapped).not.toBe(initialMnx);
    expect(history.getState().historySize).toBe(2);
    act(() => {
      history.getState().undo();
    });
    expect(store.getState().mnxJson).toBe(initialMnx);
    act(() => {
      history.getState().redo();
    });
    expect(store.getState().mnxJson).toBe(swapped);
  });
});

describe("Delete Selected Bars", () => {
  it("uses the live reversed bar range and removes it from every part in one update", () => {
    const { result, updateScore, clearSelection, score } = harness();
    act(() => {
      result.current.actions.selectMeasure(0, 0, 2);
      result.current.actions.extendMeasure(0, 0, 1);
      result.current.handleDeleteSelectedBars();
    });
    expect(updateScore).toHaveBeenCalledOnce();
    const next = updateScore.mock.calls[0]![0];
    expect(next.global.measures).toEqual([score.global.measures[0]]);
    for (const [index, part] of next.parts.entries()) {
      expect(part.measures).toEqual([score.parts[index]!.measures[0]]);
    }
    expect(score.global.measures).toHaveLength(3);
    expect(score.parts[0]!.measures).toHaveLength(3);
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it("leaves one full-measure rest per part when all bars are deleted", () => {
    const { result, updateScore, score } = harness();
    act(() => {
      result.current.actions.selectMeasure(0, 0, 0);
      result.current.actions.extendMeasure(0, 0, 2);
      result.current.handleDeleteSelectedBars();
    });
    const next = updateScore.mock.calls[0]![0];
    expect(next.global.measures).toEqual([{ id: "m0", time: { count: 3, unit: 4 }, key: { fifths: 2 } }]);
    for (const [index, part] of next.parts.entries()) {
      expect(part.measures).toHaveLength(1);
      expect(part.measures[0]!.clefs).toEqual(score.parts[index]!.measures[0]!.clefs);
      expect(part.measures[0]!.sequences).toEqual([
        { content: [], fullMeasure: { visualDuration: { base: "whole" } } },
      ]);
    }
  });

  it("can delete the sole remaining bar while leaving it empty", () => {
    const score = makeScore();
    const oneBar = removeMeasureRangeFromScore(score, 1, 2)!;
    const next = removeMeasureRangeFromScore(oneBar, 0, 0, true)!;
    expect(next.global.measures).toHaveLength(1);
    expect(next.parts.every((part) => part.measures[0]!.sequences[0]!.content.length === 0)).toBe(true);
    expect(removeMeasureRangeFromScore(oneBar, 0, 0)).toBeNull();
  });

  it("clears deleted-bar layout anchors while keeping each score's initial layout and settings", () => {
    const score = makeScore();
    score.scores = [
      {
        name: "Full score",
        layout: "default",
        useWritten: true,
        pages: [
          { systems: [{ measure: "m0", layout: "initial" }] },
          {
            systems: [
              { measure: "m2", layout: "later", layoutChanges: [{ layout: "default", location: { measure: "m2" } }] },
            ],
          },
        ],
        layoutBreaks: [{ measure: "m2", kind: "page" }],
        multimeasureRests: [{ start: "m1", duration: 2 }],
      },
      {
        name: "Flute",
        layout: "flute",
        layoutBreaks: [{ measure: "m1", kind: "system" }],
      },
    ];
    const next = removeMeasureRangeFromScore(score, 0, 2, true)!;
    expect(next.global.measures[0]!.id).toBe("m0");
    expect(next.scores).toEqual([
      { name: "Full score", layout: "initial", useWritten: true },
      { name: "Flute", layout: "flute" },
    ]);
    expect(score.scores[0]!.pages).toHaveLength(2);
  });

  it("reports missing and stale selections without changing the document", () => {
    const { result, updateScore, clearSelection } = harness();
    act(() => result.current.handleDeleteSelectedBars());
    expect(toast.info).toHaveBeenCalledOnce();
    useSelectionStore.setState({
      selection: {
        kind: "measure",
        startMeasure: 10,
        endMeasure: 11,
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
      },
    });
    act(() => result.current.handleDeleteSelectedBars());
    expect(toast.error).toHaveBeenCalledOnce();
    expect(updateScore).not.toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
  });
});

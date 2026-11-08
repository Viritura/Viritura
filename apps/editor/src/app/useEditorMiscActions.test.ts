import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { useEditorMiscActions } from "./useEditorMiscActions";
import { createDocumentStore } from "../store/documentStore";
import { resetSelectionStore, useSelectionActions, useSelectionStore } from "../store/selectionStore";
import { removeMeasureRangeFromScore } from "../keyboard/normalModeDeleteHelpers";

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
  store.setState({ score });
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

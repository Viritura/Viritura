import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Score } from "@viritura/core";
import { useGroupingDisplayInspector } from "../components/inspector/useGroupingDisplayInspector";
import type { NotationSelectionTarget } from "../commands/notationInspectorCommands";
import type { SelectionState } from "../store/selectionStore";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m0", time: { count: 7, unit: 8, beatStructure: [3, 2, 2] } }, { id: "m1" }],
    },
    parts: [
      {
        name: "Piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                staff: 1,
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }],
              },
              {
                staff: 2,
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 3 } }] }],
              },
            ],
          },
          {
            sequences: [
              {
                staff: 1,
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 5 } }] }],
              },
              {
                staff: 2,
                content: [{ type: "event", duration: { base: "whole" }, notes: [{ pitch: { step: "C", octave: 3 } }] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

const timeSignatureTarget: NotationSelectionTarget = {
  elementId: "m0/time",
  elementType: "time",
  partIndex: 0,
  measureIndex: 0,
};

function setup(score: Score, target: NotationSelectionTarget | null, selection: SelectionState) {
  const updateScore = vi.fn();
  const { result } = renderHook(() => useGroupingDisplayInspector({ score, target, selection, updateScore }));
  return { result, updateScore };
}

describe("useGroupingDisplayInspector", () => {
  it("is unavailable when there is no resolvable target", () => {
    const { result } = setup(makeScore(), null, { kind: "none" });
    expect(result.current.isAvailable).toBe(false);
  });

  it("reads the occurrence override for the selected time signature", () => {
    const score = makeScore();
    score.global.measures[0]!.time!.groupingDisplay = "annotation";
    const { result } = setup(score, timeSignatureTarget, { kind: "single", elementId: "m0/time" });

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.occurrenceOverride).toBe("annotation");
  });

  it("forces the occurrence override without disturbing count/unit/beatStructure", () => {
    const score = makeScore();
    const { result, updateScore } = setup(score, timeSignatureTarget, { kind: "single", elementId: "m0/time" });

    result.current.handleSetOccurrenceOverride("additive");

    const updated = updateScore.mock.calls[0]![0] as Score;
    expect(updated.global.measures[0]!.time).toEqual({
      count: 7,
      unit: 8,
      beatStructure: [3, 2, 2],
      groupingDisplay: "additive",
    });
  });

  it("clears the occurrence override when set to null (Auto)", () => {
    const score = makeScore();
    score.global.measures[0]!.time!.groupingDisplay = "additive";
    const { result, updateScore } = setup(score, timeSignatureTarget, { kind: "single", elementId: "m0/time" });

    result.current.handleSetOccurrenceOverride(null);

    const updated = updateScore.mock.calls[0]![0] as Score;
    expect(updated.global.measures[0]!.time).toEqual({ count: 7, unit: 8, beatStructure: [3, 2, 2] });
  });

  it("resolves and forces a per-staff override for a measure selection anchored to a staff", () => {
    const score = makeScore();
    const selection: SelectionState = {
      kind: "measure",
      startMeasure: 1,
      endMeasure: 1,
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startLocalStaffIndex: 1,
      endLocalStaffIndex: 1,
    };
    const target: NotationSelectionTarget = {
      elementId: "m1/time",
      elementType: "time",
      partIndex: 0,
      measureIndex: 1,
    };
    const { result, updateScore } = setup(score, target, selection);

    expect(result.current.staff).toBe(2);
    result.current.handleSetStaffOverride("standard");

    const updated = updateScore.mock.calls[0]![0] as Score;
    expect(updated.parts[0]!.measures[1]!.groupingDisplayOverrides).toEqual([
      { staff: 2, groupingDisplay: "standard" },
    ]);
  });

  it("has no staff override to show when no specific staff is resolvable", () => {
    const { result } = setup(makeScore(), timeSignatureTarget, { kind: "single", elementId: "m0/time" });
    expect(result.current.staff).toBeUndefined();
    expect(result.current.staffOverride).toBeUndefined();
  });
});

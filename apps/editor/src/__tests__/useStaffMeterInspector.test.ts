import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Score } from "@viritura/core";
import { useStaffMeterInspector } from "../components/inspector/useStaffMeterInspector";
import type { NotationSelectionTarget } from "../commands/notationInspectorCommands";
import type { SelectionState } from "../store/selectionStore";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m0", time: { count: 3, unit: 4 } }, { id: "m1" }],
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

function staffSelection(measureIndex: number, staff: number): SelectionState {
  return {
    kind: "measure",
    startMeasure: measureIndex,
    endMeasure: measureIndex,
    startPartIndex: 0,
    endPartIndex: 0,
    startStaffIndex: 0,
    endStaffIndex: 0,
    startLocalStaffIndex: staff - 1,
    endLocalStaffIndex: staff - 1,
  };
}

function setup(score: Score, target: NotationSelectionTarget | null, selection: SelectionState) {
  const updateScore = vi.fn();
  const { result } = renderHook(() => useStaffMeterInspector({ score, target, selection, updateScore }));
  return { result, updateScore };
}

describe("useStaffMeterInspector", () => {
  it("is unavailable when there is no resolvable staff", () => {
    const { result } = setup(makeScore(), null, { kind: "none" });
    expect(result.current.isAvailable).toBe(false);
  });

  it("reports the global meter when the staff has no declaration", () => {
    const { result } = setup(makeScore(), timeSignatureTarget, staffSelection(0, 2));
    expect(result.current.effective).toBeUndefined();
    expect(result.current.globalTimeSignature).toEqual({ count: 3, unit: 4 });
  });

  it("exposes the resolved measure/part identity for keying the section across selections", () => {
    const { result } = setup(makeScore(), timeSignatureTarget, staffSelection(0, 2));
    expect(result.current.measureIndex).toBe(0);
    expect(result.current.partIndex).toBe(0);
    expect(result.current.staff).toBe(2);

    const target: NotationSelectionTarget = {
      elementId: "m1/time",
      elementType: "time",
      partIndex: 0,
      measureIndex: 1,
    };
    const { result: result2 } = setup(makeScore(), target, staffSelection(1, 1));
    expect(result2.current.measureIndex).toBe(1);
    expect(result2.current.staff).toBe(1);
  });

  it("applies a sharedDuration staff-local meter", () => {
    const score = makeScore();
    const { result, updateScore } = setup(score, timeSignatureTarget, staffSelection(0, 2));

    result.current.handleSetStaffMeter({ count: 6, unit: 8 }, "sharedDuration");

    const updated = updateScore.mock.calls[0]![0] as Score;
    expect(updated.parts[0]!.measures[0]!.staffMeters).toEqual([
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
    ]);
  });

  it("resolves the effective staff meter once applied", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.staffMeters = [
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "sharedDuration" },
    ];
    const { result } = setup(score, timeSignatureTarget, staffSelection(0, 2));

    expect(result.current.effective?.timeSignature).toEqual({ count: 6, unit: 8 });
    expect(result.current.effective?.ratioToGlobal).toEqual({ num: 1, den: 1 });
  });

  it("surfaces a validation issue for an invalid sharedDuration declaration", () => {
    const score = makeScore();
    // 5/8 (2.5 beats) does not equal the global 3/4 (3 beats).
    score.parts[0]!.measures[0]!.staffMeters = [
      { staff: 2, meter: { count: 5, unit: 8 }, synchronization: "sharedDuration" },
    ];
    const { result } = setup(score, timeSignatureTarget, staffSelection(0, 2));

    expect(result.current.effective).toBeUndefined();
    expect(result.current.issue).toBeDefined();
    expect(result.current.issue?.staff).toBe(2);
  });

  it("resets a staff back to the global meter", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.staffMeters = [
      { staff: 2, meter: { count: 6, unit: 8 }, synchronization: "fitMeasure" },
    ];
    const target: NotationSelectionTarget = {
      elementId: "m1/time",
      elementType: "time",
      partIndex: 0,
      measureIndex: 1,
    };
    const { result, updateScore } = setup(score, target, staffSelection(1, 2));

    result.current.handleResetToGlobal();

    const updated = updateScore.mock.calls[0]![0] as Score;
    expect(updated.parts[0]!.measures[1]!.staffMeters).toEqual([{ staff: 2, useGlobal: true }]);
  });
});

import { describe, expect, it } from "vitest";
import { applyPatchesToScore, type Score } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import {
  planClearStaffLineCount,
  planSetStaffLineCount,
  readStaffLineConfig,
  resolveStaffConfigSelectionTarget,
} from "../commands/staffConfigCommands";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}, {}, {}] },
    parts: [
      {
        id: "part-1",
        name: "Percussion",
        staves: 2,
        measures: [
          {
            staffConfigs: [{ config: { lines: 1 } }],
            sequences: [
              { staff: 1, content: [] },
              { staff: 2, content: [] },
            ],
          },
          {
            sequences: [
              { staff: 1, content: [] },
              { staff: 2, content: [] },
            ],
          },
          {
            sequences: [
              { staff: 1, content: [] },
              { staff: 2, content: [] },
            ],
          },
        ],
      },
    ],
  };
}

describe("staffConfigCommands", () => {
  it("targets the selected local staff at the start of a selected measure", () => {
    const selection: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 0,
      startStaffIndex: 4,
      endStaffIndex: 4,
      startLocalStaffIndex: 1,
      endLocalStaffIndex: 1,
      startMeasure: 1,
      endMeasure: 1,
    };
    expect(resolveStaffConfigSelectionTarget(selection, makeScore())).toEqual({
      partId: "part-1",
      partIndex: 0,
      measureIndex: 1,
      staff: 2,
    });
  });

  it("uses omitted lines as a reset to five and sorts prior positioned changes", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.staffConfigs = [
      { config: {}, position: { fraction: [3, 4] } },
      { config: { lines: 3 }, position: { fraction: [1, 2] } },
      { config: { lines: 1 } },
    ];
    const target = {
      partId: "part-1",
      partIndex: 0,
      measureIndex: 1,
      staff: 1,
    };
    expect(readStaffLineConfig(score, target)).toEqual({ lines: 5, hasExplicitChange: false });
  });

  it("does not expose staff-specific configuration for a barline selection", () => {
    const selection: Selection = {
      kind: "single",
      elementId: "m0/barline",
      elementType: "barline",
      measureAnchor: { partIndex: 0, staffIndex: 1, localStaffIndex: 1, measureIndex: 0 },
    };
    expect(resolveStaffConfigSelectionTarget(selection, makeScore())).toBeNull();
  });

  it("sets, inherits, updates, and clears a measure-start line count", () => {
    const score = makeScore();
    const target = {
      partId: "part-1",
      partIndex: 0,
      measureIndex: 1,
      staff: 1,
    };
    expect(readStaffLineConfig(score, target)).toEqual({ lines: 1, hasExplicitChange: false });

    const set = applyPatchesToScore(score, planSetStaffLineCount(score, target, 3));
    expect(set.parts[0]!.measures[1]!.staffConfigs).toEqual([{ config: { lines: 3 } }]);
    expect(readStaffLineConfig(set, target)).toEqual({ lines: 3, hasExplicitChange: true });

    const updated = applyPatchesToScore(set, planSetStaffLineCount(set, target, 0));
    expect(updated.parts[0]!.measures[1]!.staffConfigs).toEqual([{ config: { lines: 0 } }]);

    const cleared = applyPatchesToScore(updated, planClearStaffLineCount(updated, target));
    expect(cleared.parts[0]!.measures[1]!.staffConfigs).toBeUndefined();
    expect(readStaffLineConfig(cleared, target)).toEqual({ lines: 1, hasExplicitChange: false });
  });

  it("preserves positioned changes and global attributes when updating a boundary", () => {
    const score = makeScore();
    score.parts[0]!.measures[1]!.staffConfigs = [
      { id: "start", config: { id: "payload", lines: 2 } },
      { config: { lines: 0 }, position: { fraction: [1, 2] } },
    ];
    const target = {
      partId: "part-1",
      partIndex: 0,
      measureIndex: 1,
      staff: 1,
    };
    const next = applyPatchesToScore(score, planSetStaffLineCount(score, target, 4));
    expect(next.parts[0]!.measures[1]!.staffConfigs).toEqual([
      { id: "start", config: { id: "payload", lines: 4 } },
      { config: { lines: 0 }, position: { fraction: [1, 2] } },
    ]);
  });
});

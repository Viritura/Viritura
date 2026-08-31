import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { toggleMeasureRepeatForSelection } from "../commands/measureRepeatCommands";
import { MEASURE_REPEAT_PALETTE_ITEMS } from "../components/palette";
import type { SelectionState } from "../store/selectionStore";

function scoreWithMeasures(count = 8, partCount = 2): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: count }, (_, index) => (index === 0 ? { time: { count: 4, unit: 4 } } : {})),
    },
    parts: Array.from({ length: partCount }, (_, partIndex) => ({
      name: `Part ${partIndex + 1}`,
      measures: Array.from({ length: count }, () => ({
        sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
      })),
    })),
  };
}

function selectedMeasure(measureIndex: number, startPartIndex = 0, endPartIndex = 0): SelectionState {
  return {
    kind: "measure",
    startPartIndex,
    endPartIndex,
    startStaffIndex: 0,
    endStaffIndex: 0,
    startMeasure: measureIndex,
    endMeasure: measureIndex,
  };
}

describe("measure-repeat palette items", () => {
  it("offers the standard one-, two-, and four-bar signs", () => {
    expect(MEASURE_REPEAT_PALETTE_ITEMS.map((item) => item.number)).toEqual([1, 2, 4]);
    expect(MEASURE_REPEAT_PALETTE_ITEMS.every((item) => item.useBravura && item.label.length > 0)).toBe(true);
  });
});

describe("toggleMeasureRepeatForSelection", () => {
  it("inserts a repeat at the first selected measure", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedMeasure(4), 2);

    expect(result.error).toBeUndefined();
    expect(result.score.parts[0]!.measures[4]!.measureRepeat).toEqual({ number: 2 });
    expect(score.parts[0]!.measures[4]!.measureRepeat).toBeUndefined();
  });

  it("applies to every selected part", () => {
    const result = toggleMeasureRepeatForSelection(scoreWithMeasures(), selectedMeasure(4, 0, 1), 4);

    expect(result.score.parts[0]!.measures[4]!.measureRepeat).toEqual({ number: 4 });
    expect(result.score.parts[1]!.measures[4]!.measureRepeat).toEqual({ number: 4 });
  });

  it("replaces a different span and toggles an identical span off", () => {
    const selection = selectedMeasure(4);
    const oneBar = toggleMeasureRepeatForSelection(scoreWithMeasures(), selection, 1).score;
    const fourBar = toggleMeasureRepeatForSelection(oneBar, selection, 4).score;
    expect(fourBar.parts[0]!.measures[4]!.measureRepeat).toEqual({ number: 4 });

    const removed = toggleMeasureRepeatForSelection(fourBar, selection, 4).score;
    expect(removed.parts[0]!.measures[4]!.measureRepeat).toBeUndefined();
  });

  it("requires enough preceding source measures", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedMeasure(1), 2);

    expect(result.score).toBe(score);
    expect(result.error).toContain("2 preceding source measures");
  });

  it("requires the complete covered range", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedMeasure(7), 2);

    expect(result.score).toBe(score);
    expect(result.error).toContain("2 available measures");
  });

  it("requires a selection", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, { kind: "none" }, 1);

    expect(result.score).toBe(score);
    expect(result.error).toContain("Select the first measure");
  });
});

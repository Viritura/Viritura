import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  measureRepeatElementIdsForSelection,
  toggleMeasureRepeatForSelection,
} from "../commands/measureRepeatCommands";
import { resolveRepeat } from "../radialMenu/repeatMenu";
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

function selectedRange(startMeasure: number, endMeasure: number, startPartIndex = 0, endPartIndex = 0): SelectionState {
  return {
    ...selectedMeasure(startMeasure, startPartIndex, endPartIndex),
    endMeasure,
  };
}

describe("measure-repeat palette items", () => {
  it("offers the standard one-, two-, and four-bar signs", () => {
    expect(MEASURE_REPEAT_PALETTE_ITEMS.map((item) => item.number)).toEqual([1, 2, 4]);
    expect(MEASURE_REPEAT_PALETTE_ITEMS.every((item) => item.useBravura && item.label.length > 0)).toBe(true);
  });

  describe("measure-repeat radial items", () => {
    it.each([
      ["measure-repeat-1", 1],
      ["measure-repeat-2", 2],
      ["measure-repeat-4", 4],
    ] as const)("resolves %s to a %i-bar repeat command", (id, number) => {
      expect(resolveRepeat(id)).toEqual({ kind: "measure-repeat", number });
    });
  });
});

describe("toggleMeasureRepeatForSelection", () => {
  it("fills a divisible range with explicitly numbered repeat blocks", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedRange(2, 5), 2);

    expect(result.error).toBeUndefined();
    expect(result.score.parts[0]!.measures[2]!.measureRepeat).toEqual({
      number: 2,
      counter: { count: 2 },
    });

    expect(result.score.parts[0]!.measures[3]!.measureRepeat).toBeUndefined();
    expect(result.score.parts[0]!.measures[4]!.measureRepeat).toEqual({
      number: 2,
      counter: { count: 3 },
    });
    expect(result.score.parts[0]!.measures[5]!.measureRepeat).toBeUndefined();
    expect(score.parts[0]!.measures[2]!.measureRepeat).toBeUndefined();
  });

  it("applies to every selected part", () => {
    const result = toggleMeasureRepeatForSelection(scoreWithMeasures(), selectedRange(4, 7, 0, 1), 4);

    expect(result.score.parts[0]!.measures[4]!.measureRepeat).toEqual({ number: 4, counter: { count: 2 } });
    expect(result.score.parts[1]!.measures[4]!.measureRepeat).toEqual({ number: 4, counter: { count: 2 } });
  });

  it("replaces a different span and toggles an identical span off", () => {
    const selection = selectedRange(4, 7);
    const oneBar = toggleMeasureRepeatForSelection(scoreWithMeasures(), selection, 1).score;
    const fourBar = toggleMeasureRepeatForSelection(oneBar, selection, 4).score;
    expect(fourBar.parts[0]!.measures[4]!.measureRepeat).toEqual({ number: 4, counter: { count: 2 } });
    expect(fourBar.parts[0]!.measures[5]!.measureRepeat).toBeUndefined();

    const removed = toggleMeasureRepeatForSelection(fourBar, selection, 4).score;
    expect(removed.parts[0]!.measures[4]!.measureRepeat).toBeUndefined();
  });

  it("requires the selected range length to be divisible by the repeat span", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedRange(2, 4), 2);

    expect(result.score).toBe(score);
    expect(result.error).toContain("divisible by 2");
    expect(result.error).toContain("3 measures");
  });

  it("requires enough preceding source measures", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedRange(1, 2), 2);

    expect(result.score).toBe(score);
    expect(result.error).toContain("2 preceding source measures");
  });

  it("requires the complete selected range", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, selectedRange(7, 8), 2);

    expect(result.score).toBe(score);
    expect(result.error).toContain("extends beyond the score");
  });

  it("requires a selection", () => {
    const score = scoreWithMeasures();
    const result = toggleMeasureRepeatForSelection(score, { kind: "none" }, 1);

    expect(result.score).toBe(score);
    expect(result.error).toContain("Select the first measure");
  });
});

describe("measureRepeatElementIdsForSelection", () => {
  it("expands a Shift-click range to every repeat sign between its endpoints", () => {
    const score = scoreWithMeasures();
    for (const measureIndex of [2, 3, 4]) {
      score.parts[0]!.measures[measureIndex]!.measureRepeat = { number: 1 };
    }

    expect(
      measureRepeatElementIdsForSelection(score, {
        kind: "range",
        startElementId: "p0/m2/measurerepeat",
        endElementId: "p0/m4/measurerepeat",
      }),
    ).toEqual(["p0/m2/measurerepeat", "p0/m3/measurerepeat", "p0/m4/measurerepeat"]);
  });
});

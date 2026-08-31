import { describe, expect, it } from "vitest";
import type { GlobalMeasure, PartMeasure, Score } from "@viritura/core";
import { detectToCodaMeasureIndex, expandMeasureOrder } from "../repeatExpansion";

function makeMeasures(count: number): GlobalMeasure[] {
  return Array.from({ length: count }, () => ({ time: { count: 2, unit: 4 } }) as GlobalMeasure);
}

function makeScoreWithToCoda(count: number, toCodaIdx: number): Score {
  const measures: PartMeasure[] = Array.from(
    { length: count },
    () => ({ sequences: [{ content: [] }] }) as PartMeasure,
  );
  measures[toCodaIdx] = {
    sequences: [{ content: [] }],
    expressions: [{ text: "To Coda", position: { fraction: [1, 2] }, placement: "above" }],
  } as PartMeasure;

  return {
    mnx: { version: 1 },
    global: { measures: makeMeasures(count) },
    parts: [{ id: "p1", name: "Part", measures }],
  } as unknown as Score;
}

describe("repeat expansion with al coda jumps", () => {
  it("cuts D.C. al Coda at the detected To Coda measure", () => {
    const score = makeScoreWithToCoda(8, 2);
    const globalMeasures = score.global.measures;
    globalMeasures[4]!.jump = { type: "dcalcoda", location: { fraction: [1, 1] } } as never;
    globalMeasures[6]!.coda = { location: { fraction: [0, 1] } } as never;

    const toCodaMeasureIndex = detectToCodaMeasureIndex(score);
    const order = expandMeasureOrder(globalMeasures, { toCodaMeasureIndex });

    expect(order).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 6, 7]);
  });

  it("cuts D.S. al Coda at To Coda after jumping to segno", () => {
    const score = makeScoreWithToCoda(8, 3);
    const globalMeasures = score.global.measures;
    globalMeasures[1]!.segno = { location: { fraction: [0, 1] } };
    globalMeasures[5]!.jump = { type: "dsalcoda", location: { fraction: [1, 1] } } as never;
    globalMeasures[6]!.coda = { location: { fraction: [0, 1] } } as never;

    const toCodaMeasureIndex = detectToCodaMeasureIndex(score);
    const order = expandMeasureOrder(globalMeasures, { toCodaMeasureIndex });

    expect(order).toEqual([0, 1, 2, 3, 4, 5, 1, 2, 3, 6, 7]);
  });
});

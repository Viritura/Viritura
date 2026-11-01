import { describe, expect, it } from "vitest";
import type { GlobalMeasure } from "@viritura/core";
import { expandPlaybackItinerary, expandMeasureOrder } from "../repeatExpansion";
import { NavigationError } from "../navigation";

function measures(count: number): GlobalMeasure[] {
  return Array.from({ length: count }, () => ({ time: { count: 4, unit: 4 } }));
}

function jump(
  measure: GlobalMeasure,
  type: NonNullable<GlobalMeasure["jump"]>["type"],
  fraction: [number, number] = [1, 1],
): void {
  measure.jump = { type, location: { fraction } };
}

describe("native navigation itinerary", () => {
  it("ignores To Coda until replay is armed", () => {
    const score = measures(8);
    jump(score[2]!, "toCoda");
    jump(score[4]!, "dcAlCoda");
    score[6]!.coda = { location: { fraction: [0, 1] } };
    expect(expandMeasureOrder(score)).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 6, 7]);
  });

  it("honors repeats and multi-measure endings after landing in the coda", () => {
    const score = measures(12);
    score[1]!.segno = { location: { fraction: [0, 1] } };
    jump(score[2]!, "toCoda");
    jump(score[4]!, "dsAlCoda");
    score[6]!.coda = { location: { fraction: [0, 1] } };
    score[7]!.repeatStart = true;
    score[8]!.ending = { numbers: [1], duration: 2 };
    score[9]!.repeatEnd = {};
    score[10]!.ending = { numbers: [2], duration: 1, open: true };

    expect(expandMeasureOrder(score)).toEqual([0, 1, 2, 3, 4, 1, 2, 6, 7, 8, 9, 7, 10, 11]);
  });

  it("retains a mid-measure coda landing before repeating that measure in full", () => {
    const score = measures(9);
    jump(score[1]!, "toCoda");
    jump(score[3]!, "dcAlCoda");
    score[5]!.coda = { location: { fraction: [1, 4] } };
    score[5]!.repeatStart = true;
    score[6]!.repeatEnd = {};

    expect(expandPlaybackItinerary(score).filter((span) => span.measureIndex >= 5)).toEqual([
      { measureIndex: 5, startBeat: 1, endBeat: 4, measureBeats: 4 },
      { measureIndex: 6, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 5, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 6, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 7, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 8, startBeat: 0, endBeat: 4, measureBeats: 4 },
    ]);
  });

  it("can jump into an otherwise skipped ending and honor later repeats", () => {
    const score = measures(11);
    jump(score[1]!, "toCoda");
    jump(score[3]!, "dcAlCoda");
    score[4]!.repeatStart = true;
    score[5]!.coda = { location: { fraction: [0, 1] } };
    score[5]!.ending = { numbers: [3], duration: 1 };
    score[5]!.repeatEnd = {};
    score[7]!.repeatStart = true;
    score[8]!.repeatEnd = {};

    expect(expandMeasureOrder(score)).toEqual([0, 1, 2, 3, 0, 1, 5, 6, 7, 8, 7, 8, 9, 10]);
  });

  it("replays from a nonzero segno and ends at a nonzero Fine", () => {
    const score = measures(4);
    score[1]!.segno = { location: { fraction: [1, 4] } };
    score[2]!.fine = { location: { fraction: [1, 2] } };
    jump(score[3]!, "dsAlFine", [3, 4]);
    expect(expandPlaybackItinerary(score)).toEqual([
      { measureIndex: 0, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 1, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 2, startBeat: 0, endBeat: 4, measureBeats: 4 },
      { measureIndex: 3, startBeat: 0, endBeat: 3, measureBeats: 4 },
      { measureIndex: 1, startBeat: 1, endBeat: 4, measureBeats: 4 },
      { measureIndex: 2, startBeat: 0, endBeat: 2, measureBeats: 4 },
    ]);
  });

  it.each(["dc", "segno"] as const)("does not arm Fine for plain %s", (type) => {
    const score = measures(3);
    score[0]!.segno = { location: { fraction: [0, 1] } };
    score[1]!.fine = { location: { fraction: [1, 1] } };
    jump(score[2]!, type);
    expect(expandMeasureOrder(score)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("honors repeats before taking the concluding jump", () => {
    const score = measures(2);
    score[0]!.repeatStart = true;
    score[1]!.repeatEnd = {};
    score[0]!.fine = { location: { fraction: [1, 1] } };
    jump(score[1]!, "dcAlFine");
    expect(expandMeasureOrder(score)).toEqual([0, 1, 0, 1, 0]);
  });

  it("rejects missing or ambiguous destinations and obsolete jump types", () => {
    const score = measures(3);
    jump(score[2]!, "dsAlFine");
    expect(() => expandPlaybackItinerary(score)).toThrow(NavigationError);
    score[0]!.segno = { location: { fraction: [0, 1] } };
    score[1]!.segno = { location: { fraction: [0, 1] } };
    expect(() => expandPlaybackItinerary(score)).toThrow("exactly one segno");
    Reflect.set(score[2]!, "jump", { type: "dsalfine", location: { fraction: [1, 1] } });
    expect(() => expandPlaybackItinerary(score)).toThrow("Unsupported jump type");
  });

  it("requires an explicit To Coda rather than guessing from marker text", () => {
    const score = measures(3);
    jump(score[1]!, "dcAlCoda");
    score[2]!.coda = { location: { fraction: [0, 1] } };
    expect(() => expandPlaybackItinerary(score)).toThrow("explicit To Coda");
  });
});

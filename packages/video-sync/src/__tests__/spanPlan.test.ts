import { describe, expect, it } from "vitest";
import {
  normalizePlan,
  planBars,
  planBeats,
  planMeters,
  removeSegment,
  setSegmentBars,
  setSegmentMeter,
  solvePlan,
  splitSegment,
  suggestPlan,
  type SpanPlan,
} from "../spanPlan";

const FOUR_FOUR = { count: 4, unit: 4 };
const THREE_FOUR = { count: 3, unit: 4 };
const SIX_EIGHT = { count: 6, unit: 8 };

function plan(segments: SpanPlan["segments"], seconds = 10): SpanPlan {
  return { fromSeconds: 0, toSeconds: seconds, segments };
}

describe("counting", () => {
  it("counts beats in quarter notes regardless of the written unit", () => {
    expect(planBeats(plan([{ meter: FOUR_FOUR, bars: 4 }]))).toBe(16);
    expect(planBeats(plan([{ meter: SIX_EIGHT, bars: 2 }]))).toBe(6);
  });

  it("adds runs together", () => {
    const p = plan([
      { meter: FOUR_FOUR, bars: 4 },
      { meter: THREE_FOUR, bars: 1 },
    ]);
    expect(planBeats(p)).toBe(19);
    expect(planBars(p)).toBe(5);
  });

  it("expands to one meter per bar in order", () => {
    const meters = planMeters(
      plan([
        { meter: FOUR_FOUR, bars: 2 },
        { meter: THREE_FOUR, bars: 1 },
      ]),
    );
    expect(meters).toEqual([FOUR_FOUR, FOUR_FOUR, THREE_FOUR]);
  });
});

describe("solvePlan", () => {
  it("derives the tempo the plan implies", () => {
    // 16 quarter notes across 8 seconds is exactly 120.
    const solution = solvePlan(plan([{ meter: FOUR_FOUR, bars: 4 }], 8), 24);
    expect(solution?.exactBpm).toBeCloseTo(120, 9);
    expect(solution?.bpm).toBe(120);
    expect(solution?.errorFrames).toBeCloseTo(0, 9);
  });

  it("writes the fractional tempo needed to land exactly", () => {
    const solution = solvePlan(plan([{ meter: FOUR_FOUR, bars: 4 }], 9.95), 24);
    expect(solution?.exactBpm).toBeCloseTo(96.4824, 3);
    expect(solution?.bpm).toBeCloseTo(96.4824, 3);
    expect(solution?.errorFrames).toBeCloseTo(0, 9);
  });

  it("is null for a plan with no music yet", () => {
    expect(solvePlan(plan([]), 24)).toBeNull();
    expect(solvePlan(plan([{ meter: FOUR_FOUR, bars: 4 }], 0), 24)).toBeNull();
  });

  it("preserves a positive sub-1 BPM tempo", () => {
    const solution = solvePlan(plan([{ meter: FOUR_FOUR, bars: 1 }], 100000), 24);
    expect(solution?.bpm).toBeCloseTo(0.0024, 9);
    expect(solution?.errorFrames).toBeCloseTo(0, 9);
  });
});

describe("suggestPlan", () => {
  it("starts from the bar count nearest the tempo the composer would write", () => {
    // 10 s at 120 BPM is 20 quarter notes: five bars of 4/4.
    const suggested = suggestPlan(0, 10, { meter: FOUR_FOUR, preferredBpm: 120 });
    expect(suggested.segments).toEqual([{ meter: FOUR_FOUR, bars: 5 }]);
    expect(solvePlan(suggested, 24)?.bpm).toBe(120);
  });

  it("always suggests at least one bar", () => {
    const suggested = suggestPlan(0, 0.2, { meter: FOUR_FOUR, preferredBpm: 60 });
    expect(planBars(suggested)).toBe(1);
  });
});

describe("editing", () => {
  const base = plan([
    { meter: FOUR_FOUR, bars: 4 },
    { meter: THREE_FOUR, bars: 1 },
  ]);

  it("changes a run's bar count", () => {
    expect(setSegmentBars(base, 0, 6).segments[0]).toEqual({ meter: FOUR_FOUR, bars: 6 });
  });

  it("drops a run taken to zero rather than leaving an empty one", () => {
    expect(setSegmentBars(base, 1, 0).segments).toHaveLength(1);
  });

  it("changes a run's meter", () => {
    expect(setSegmentMeter(base, 0, SIX_EIGHT).segments[0]?.meter).toEqual(SIX_EIGHT);
  });

  it("splits a run so a meter change can start partway through", () => {
    const split = splitSegment(base, 0, 2);
    expect(split.segments.map((s) => s.bars)).toEqual([2, 2, 1]);
    // Splitting must not change the music.
    expect(planBeats(split)).toBe(planBeats(base));
  });

  it("clamps a split rather than producing an empty side", () => {
    // The invariant is that both sides exist and the music is unchanged; a
    // request outside that range is nudged into it rather than rejected, so a
    // drag to the very edge of a run does something sensible.
    for (const at of [0, 1, 3, 4, 99]) {
      const split = splitSegment(base, 0, at);
      expect(split.segments.every((segment) => segment.bars > 0)).toBe(true);
      expect(planBeats(split)).toBe(planBeats(base));
    }
  });

  it("leaves the plan alone when the run does not exist", () => {
    expect(splitSegment(base, 9, 1).segments).toEqual(base.segments);
  });

  it("removes a run", () => {
    expect(removeSegment(base, 1).segments).toHaveLength(1);
  });

  it("merges adjacent runs in the same meter", () => {
    const messy = plan([
      { meter: FOUR_FOUR, bars: 2 },
      { meter: FOUR_FOUR, bars: 1 },
      { meter: THREE_FOUR, bars: 1 },
    ]);
    expect(normalizePlan(messy).segments).toEqual([
      { meter: FOUR_FOUR, bars: 3 },
      { meter: THREE_FOUR, bars: 1 },
    ]);
  });

  it("normalizing never changes the music", () => {
    const messy = plan([
      { meter: FOUR_FOUR, bars: 2 },
      { meter: FOUR_FOUR, bars: 1 },
    ]);
    expect(planMeters(normalizePlan(messy))).toEqual(planMeters(messy));
  });
});

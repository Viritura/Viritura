/**
 * Solver tests.
 *
 * The benchmark throughout is the Caminandes cue in
 * `packages/format/fixtures/mnx/`, which was fitted by hand with a throwaway
 * script before this existed. Its spans are the real cases: a 19.75s train
 * chase, a 0.45s bar catching two head bonks, and a 2.00s title card that has an
 * exact integer answer.
 */

import { describe, expect, it } from "vitest";
import { beatsPerBar, exactTempo, fitSpan } from "../fitSpan";
import type { SpanFitRequest, TimeSignature } from "../cueTypes";

const FOUR_FOUR: TimeSignature = { count: 4, unit: 4 };
const THREE_FOUR: TimeSignature = { count: 3, unit: 4 };
const TWO_FOUR: TimeSignature = { count: 2, unit: 4 };
const ONE_FOUR: TimeSignature = { count: 1, unit: 4 };

function request(overrides: Partial<SpanFitRequest> & { seconds: number }): SpanFitRequest {
  return {
    meters: [FOUR_FOUR],
    minBars: 1,
    maxBars: 16,
    minBpm: 40,
    maxBpm: 200,
    frameRate: 24,
    ...overrides,
  };
}

describe("beatsPerBar", () => {
  it("measures meters in quarter notes", () => {
    expect(beatsPerBar(FOUR_FOUR)).toBe(4);
    expect(beatsPerBar(THREE_FOUR)).toBe(3);
    expect(beatsPerBar({ count: 6, unit: 8 })).toBe(3);
    expect(beatsPerBar({ count: 2, unit: 2 })).toBe(4);
  });
});

describe("exactTempo", () => {
  it("reports a fractional tempo", () => {
    // 12 bars of 4/4 plus a 3/4 across 19.75s — the cue's train chase.
    expect(exactTempo(51, 19.75)).toBeCloseTo(154.9367, 3);
  });
});

describe("fitSpan", () => {
  it("finds the exact answer when one exists", () => {
    // Two bars of 4/4 across 2 seconds is exactly 240 BPM; at a plausible tempo
    // it is 8 beats in 4s = 120.
    const fit = fitSpan(request({ seconds: 4, preferredBpm: 120 }));
    expect(fit.best?.bpm).toBe(120);
    expect(fit.best?.bars).toBe(2);
    expect(fit.best?.errorFrames).toBeCloseTo(0, 6);
  });

  it("lands the train chase within a frame", () => {
    const fit = fitSpan(
      request({
        seconds: 19.75,
        meters: [FOUR_FOUR],
        tailMeters: [THREE_FOUR, TWO_FOUR],
        minBars: 10,
        maxBars: 14,
        minBpm: 138,
        maxBpm: 168,
        preferredBpm: 152,
      }),
    );
    expect(fit.best).toBeDefined();
    expect(Math.abs(fit.best!.errorFrames)).toBeLessThan(1);
  });

  it("catches a half-second hit with a single short bar", () => {
    // The two head bonks are 0.45s apart; only a 1/4 bar is short enough at a
    // tempo anyone would play.
    const fit = fitSpan(
      request({
        seconds: 0.45,
        meters: [ONE_FOUR],
        minBars: 1,
        maxBars: 1,
        minBpm: 110,
        maxBpm: 170,
        preferredBpm: 133,
      }),
    );
    expect(fit.best?.bars).toBe(1);
    expect(Math.abs(fit.best!.errorFrames)).toBeLessThan(1);
  });

  it("ranks exact candidates by musical preference", () => {
    const fit = fitSpan(request({ seconds: 10, preferredBpm: 100 }));
    expect(fit.best?.bpm).toBeCloseTo(96, 9);
    expect(fit.best?.errorFrames).toBeCloseTo(0, 9);
  });

  it("prefers the requested tempo when accuracy is equal", () => {
    // 8 beats in 4s is exactly 120; 16 beats in 8s is also exactly 120. With two
    // exact answers available the tempo hint decides.
    const near = fitSpan(request({ seconds: 8, minBars: 2, maxBars: 8, preferredBpm: 120 }));
    expect(near.best?.bpm).toBe(120);
  });

  it("prefers uniform bars over a tail when both land equally", () => {
    const fit = fitSpan(
      request({ seconds: 8, meters: [FOUR_FOUR], tailMeters: [TWO_FOUR], minBars: 4, maxBars: 4, preferredBpm: 120 }),
    );
    expect(fit.best?.tailMeter).toBeUndefined();
  });

  it("uses fractional BPM to land exactly", () => {
    const fit = fitSpan(request({ seconds: 10.3, minBars: 5, maxBars: 5, minBpm: 100, maxBpm: 140 }));
    expect(fit.best?.bpm).toBeCloseTo(116.504854, 6);
    expect(fit.best?.errorFrames).toBeCloseTo(0, 9);
  });

  it("returns nothing rather than a bad guess when constraints cannot be met", () => {
    // Four bars of 4/4 in one second needs 960 BPM.
    const fit = fitSpan(request({ seconds: 1, minBars: 4, maxBars: 4, minBpm: 60, maxBpm: 200 }));
    expect(fit.candidates).toHaveLength(0);
    expect(fit.best).toBeUndefined();
  });

  it("lands exactly at different frame rates", () => {
    const base = { seconds: 7.3, minBars: 3, maxBars: 5, preferredBpm: 120 };
    const at24 = fitSpan(request({ ...base, frameRate: 24 }));
    const at30 = fitSpan(request({ ...base, frameRate: 30 }));
    expect(at24.best?.bpm).toBe(at30.best?.bpm);
    expect(at24.best?.errorFrames).toBeCloseTo(0, 9);
    expect(at30.best?.errorFrames).toBeCloseTo(0, 9);
  });

  it("does not offer the same music twice", () => {
    const fit = fitSpan(request({ seconds: 12, meters: [FOUR_FOUR, THREE_FOUR], tailMeters: [TWO_FOUR] }));
    const keys = fit.candidates.map(
      (c) => `${c.bars}:${c.meter.count}/${c.meter.unit}:${c.tailMeter?.count ?? "-"}:${c.bpm}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

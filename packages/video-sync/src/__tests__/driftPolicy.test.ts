import { describe, expect, it } from "vitest";
import { DEFAULT_DRIFT_POLICY, decideCorrection, isOutOfTolerance } from "../driftPolicy";

const sustained = DEFAULT_DRIFT_POLICY.sustainedSamplesBeforeNudge;

describe("driftPolicy", () => {
  it("holds within a frame of tolerance", () => {
    expect(decideCorrection({ driftSeconds: 0.01, consecutiveOutOfTolerance: 0 })).toEqual({ kind: "hold" });
    expect(decideCorrection({ driftSeconds: -0.02, consecutiveOutOfTolerance: 0 })).toEqual({ kind: "hold" });
  });

  it("does not nudge on a single out-of-tolerance sample", () => {
    expect(decideCorrection({ driftSeconds: 0.2, consecutiveOutOfTolerance: 1 })).toEqual({ kind: "hold" });
  });

  it("nudges once the drift is sustained", () => {
    const correction = decideCorrection({ driftSeconds: 0.2, consecutiveOutOfTolerance: sustained });
    expect(correction.kind).toBe("nudge");
    if (correction.kind !== "nudge") throw new Error("expected nudge");
    // Picture is behind, so it must run faster than realtime.
    expect(correction.playbackRate).toBeGreaterThan(1);
    expect(correction.playbackRate).toBeLessThanOrEqual(1 + DEFAULT_DRIFT_POLICY.maxRateDeviation);
  });

  it("nudges the other way when the picture is ahead", () => {
    const correction = decideCorrection({ driftSeconds: -0.2, consecutiveOutOfTolerance: sustained });
    if (correction.kind !== "nudge") throw new Error("expected nudge");
    expect(correction.playbackRate).toBeLessThan(1);
    expect(correction.playbackRate).toBeGreaterThanOrEqual(1 - DEFAULT_DRIFT_POLICY.maxRateDeviation);
  });

  it("scales the nudge with the size of the drift", () => {
    const small = decideCorrection({ driftSeconds: 0.05, consecutiveOutOfTolerance: sustained });
    const large = decideCorrection({ driftSeconds: 0.45, consecutiveOutOfTolerance: sustained });
    if (small.kind !== "nudge" || large.kind !== "nudge") throw new Error("expected nudges");
    expect(large.playbackRate).toBeGreaterThan(small.playbackRate);
  });

  it("hard-seeks past the nudge band regardless of how long it has been drifting", () => {
    expect(decideCorrection({ driftSeconds: 2, consecutiveOutOfTolerance: 0 })).toEqual({
      kind: "seek",
      reason: "drift",
    });
    expect(decideCorrection({ driftSeconds: -2, consecutiveOutOfTolerance: 99 })).toEqual({
      kind: "seek",
      reason: "drift",
    });
  });

  it("never exceeds the configured rate deviation", () => {
    for (let drift = 0; drift < DEFAULT_DRIFT_POLICY.hardSeekToleranceSeconds; drift += 0.01) {
      const correction = decideCorrection({ driftSeconds: drift, consecutiveOutOfTolerance: sustained });
      if (correction.kind !== "nudge") continue;
      expect(Math.abs(correction.playbackRate - 1)).toBeLessThanOrEqual(DEFAULT_DRIFT_POLICY.maxRateDeviation + 1e-9);
    }
  });

  it("reports tolerance status for the sustained-sample counter", () => {
    expect(isOutOfTolerance(0.001)).toBe(false);
    expect(isOutOfTolerance(0.1)).toBe(true);
    expect(isOutOfTolerance(-0.1)).toBe(true);
  });
});

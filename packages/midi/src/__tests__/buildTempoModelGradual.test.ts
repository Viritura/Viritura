import { describe, it, expect } from "vitest";
import type { GlobalMeasure } from "@viritura/core";
import { buildTempoModel } from "../tempoMap";

/** Quarter-note tempo marking helper. */
function tempo(bpm: number) {
  return { bpm, value: { base: "quarter" as const } };
}

describe("buildTempoModel — gradual tempo (rit./accel.)", () => {
  it("ramps linearly in BPM across the declared span", () => {
    // m0: 120 bpm. m1: rit. from start of m1 to start of m2, target 60 bpm. All 4/4.
    const measures: GlobalMeasure[] = [
      { id: "m0", time: { count: 4, unit: 4 }, tempos: [tempo(120)] },
      {
        id: "m1",
        gradualTempo: {
          position: { fraction: [0, 1] },
          end: { measure: "m2", position: { fraction: [0, 1] } },
          endBpm: 60,
        },
      },
      { id: "m2" },
    ];

    const { model, measureStartBeats, measureStartTimes } = buildTempoModel(measures);

    expect(measureStartBeats).toEqual([0, 4, 8]);

    // m0 is constant 120 → 4 quarters × 0.5 s = 2.0 s to reach beat 4.
    expect(measureStartTimes[1]).toBeCloseTo(2.0, 5);

    // Mid-ramp (beat 6) the BPM is the linear midpoint of 120 → 60 = 90.
    expect(model.bpmAtBeat(6)).toBeCloseTo(90, 5);

    // The ramp [beat 4 → 8] integrates to (60/slope)·ln(60/120), slope = -15.
    const rampSeconds = (60 / -15) * Math.log(60 / 120);
    expect(measureStartTimes[2]).toBeCloseTo(2.0 + rampSeconds, 5);
  });

  it("holds endBpm after the ramp when no 'a tempo' marking follows", () => {
    const measures: GlobalMeasure[] = [
      { id: "m0", time: { count: 4, unit: 4 }, tempos: [tempo(120)] },
      {
        id: "m1",
        gradualTempo: {
          position: { fraction: [0, 1] },
          end: { measure: "m2", position: { fraction: [0, 1] } },
          endBpm: 60,
        },
      },
      { id: "m2" },
      { id: "m3" },
    ];

    const { model, measureStartBeats } = buildTempoModel(measures);

    // m2 starts at beat 8; after the ramp the tempo holds at 60 bpm.
    expect(measureStartBeats[2]).toBe(8);
    expect(model.bpmAtBeat(8)).toBeCloseTo(60, 5);
    expect(model.bpmAtBeat(10)).toBeCloseTo(60, 5);
  });

  it("resumes the next explicit tempo ('a tempo') after the ramp", () => {
    const measures: GlobalMeasure[] = [
      { id: "m0", time: { count: 4, unit: 4 }, tempos: [tempo(120)] },
      {
        id: "m1",
        gradualTempo: {
          position: { fraction: [0, 1] },
          end: { measure: "m2", position: { fraction: [0, 1] } },
          endBpm: 60,
        },
      },
      { id: "m2", tempos: [tempo(120)] },
    ];

    const { model } = buildTempoModel(measures);

    // The ramp ends at beat 8 where an explicit 120 bpm tempo takes over.
    expect(model.bpmAtBeat(7.999)).toBeLessThan(70);
    expect(model.bpmAtBeat(8)).toBeCloseTo(120, 5);
  });

  it("uses an explicit startBpm when provided", () => {
    const measures: GlobalMeasure[] = [
      { id: "m0", time: { count: 4, unit: 4 }, tempos: [tempo(120)] },
      {
        id: "m1",
        gradualTempo: {
          position: { fraction: [0, 1] },
          end: { measure: "m2", position: { fraction: [0, 1] } },
          endBpm: 200,
          startBpm: 100,
          kind: "accel",
        },
      },
      { id: "m2" },
    ];

    const { model } = buildTempoModel(measures);
    expect(model.bpmAtBeat(4)).toBeCloseTo(100, 5);
    expect(model.bpmAtBeat(6)).toBeCloseTo(150, 5);
    expect(model.bpmAtBeat(8)).toBeCloseTo(200, 5);
  });
});

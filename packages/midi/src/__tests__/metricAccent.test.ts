import { describe, it, expect } from "vitest";
import { metricAccentOffset, velocityHumanize, timingHumanize } from "../dynamics";

const TIME_4_4 = { count: 4, unit: 4 };
const TIME_3_4 = { count: 3, unit: 4 };
const TIME_2_2 = { count: 2, unit: 2 };

describe("metricAccentOffset", () => {
  it("downbeat (beat 0) gets maximum positive offset", () => {
    expect(metricAccentOffset(0, TIME_4_4)).toBe(6);
  });

  it("beat 2 (half-measure) is strong but weaker than downbeat", () => {
    const offset = metricAccentOffset(2, TIME_4_4);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(metricAccentOffset(0, TIME_4_4));
  });

  it("beats 1 and 3 (quarter-note grid) are weaker than beat 2", () => {
    const beat1 = metricAccentOffset(1, TIME_4_4);
    const beat3 = metricAccentOffset(3, TIME_4_4);
    const beat2 = metricAccentOffset(2, TIME_4_4);
    expect(beat1).toBeLessThan(beat2);
    expect(beat3).toBeLessThan(beat2);
    // beats 1 and 3 should be equal by symmetry
    expect(beat1).toBe(beat3);
  });

  it("8th-note offbeats are weaker than quarter-note beats", () => {
    const beat1 = metricAccentOffset(1, TIME_4_4);
    const eighthOff = metricAccentOffset(0.5, TIME_4_4);
    expect(eighthOff).toBeLessThan(beat1);
  });

  it("16th-note offbeats are weaker than 8th notes", () => {
    const eighth = metricAccentOffset(0.5, TIME_4_4);
    const sixteenth = metricAccentOffset(0.25, TIME_4_4);
    expect(sixteenth).toBeLessThan(eighth);
  });

  it("offset is within ±6 range", () => {
    for (let beat = 0; beat < 4; beat += 0.25) {
      const offset = metricAccentOffset(beat, TIME_4_4);
      expect(offset).toBeGreaterThanOrEqual(-6);
      expect(offset).toBeLessThanOrEqual(6);
    }
  });

  it("works with 3/4 time", () => {
    const downbeat = metricAccentOffset(0, TIME_3_4);
    expect(downbeat).toBe(6);
    // beat 1 and beat 2 should be weaker
    expect(metricAccentOffset(1, TIME_3_4)).toBeLessThan(downbeat);
    expect(metricAccentOffset(2, TIME_3_4)).toBeLessThan(downbeat);
  });

  it("works with 2/2 (cut time)", () => {
    const downbeat = metricAccentOffset(0, TIME_2_2);
    expect(downbeat).toBe(6);
    // beat 2 (half-measure) should be positive but less than downbeat
    const halfMeasure = metricAccentOffset(2, TIME_2_2);
    expect(halfMeasure).toBeGreaterThan(0);
    expect(halfMeasure).toBeLessThan(downbeat);
  });

  it("handles zero or negative measure beats gracefully", () => {
    expect(metricAccentOffset(0, { count: 0, unit: 4 })).toBe(0);
  });

  it("wraps beat positions beyond measure length", () => {
    // beat 4.0 in 4/4 wraps to beat 0 (downbeat)
    expect(metricAccentOffset(4, TIME_4_4)).toBe(metricAccentOffset(0, TIME_4_4));
  });
});

describe("velocityHumanize", () => {
  it("returns values within ±2 range", () => {
    for (let m = 0; m < 10; m++) {
      for (let b = 0; b < 4; b += 0.25) {
        const jitter = velocityHumanize(m * 2.5, b);
        expect(jitter).toBeGreaterThanOrEqual(-2);
        expect(jitter).toBeLessThanOrEqual(2);
      }
    }
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = velocityHumanize(5.0, 1.5);
    const b = velocityHumanize(5.0, 1.5);
    expect(a).toBe(b);
  });

  it("varies across different beat positions within a measure", () => {
    const values = new Set<number>();
    for (let b = 0; b < 4; b += 0.25) {
      values.add(velocityHumanize(0, b));
    }
    // With 16 different beat positions, we expect at least 2 distinct values
    expect(values.size).toBeGreaterThanOrEqual(2);
  });

  it("varies across different measures", () => {
    const values = new Set<number>();
    for (let m = 0; m < 20; m++) {
      values.add(velocityHumanize(m * 2.4, 0));
    }
    expect(values.size).toBeGreaterThanOrEqual(2);
  });

  it("returns an integer", () => {
    for (let m = 0; m < 5; m++) {
      for (let b = 0; b < 4; b += 0.5) {
        const jitter = velocityHumanize(m * 3.1, b);
        expect(Number.isInteger(jitter)).toBe(true);
      }
    }
  });

  it("preserves metric accent hierarchy: downbeat always stronger than quarter beats", () => {
    // For any measure, downbeat (metric +6) + humanize should always
    // exceed quarter-beat (metric +1) + humanize by at least 1
    const timeSig = TIME_4_4;
    for (let m = 0; m < 50; m++) {
      const mst = m * 2.4; // measure start time
      const downbeatTotal = metricAccentOffset(0, timeSig) + velocityHumanize(mst, 0);
      const quarterTotal = metricAccentOffset(1, timeSig) + velocityHumanize(mst, 1);
      expect(downbeatTotal).toBeGreaterThan(quarterTotal);
    }
  });
});

describe("timingHumanize", () => {
  it("returns values within ±15 ms", () => {
    for (let m = 0; m < 10; m++) {
      for (let b = 0; b < 4; b += 0.25) {
        for (let p = 0; p < 4; p++) {
          const jitter = timingHumanize(m * 2.5, b, p);
          expect(jitter).toBeGreaterThanOrEqual(-0.015);
          expect(jitter).toBeLessThanOrEqual(0.015);
        }
      }
    }
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = timingHumanize(5.0, 1.5, 2);
    const b = timingHumanize(5.0, 1.5, 2);
    expect(a).toBe(b);
  });

  it("varies across different beat positions", () => {
    const values = new Set<number>();
    for (let b = 0; b < 4; b += 0.25) {
      values.add(timingHumanize(0, b, 0));
    }
    expect(values.size).toBeGreaterThanOrEqual(2);
  });

  it("varies across different part indices (unison differentiation)", () => {
    const values = new Set<number>();
    for (let p = 0; p < 8; p++) {
      values.add(timingHumanize(0, 0, p));
    }
    // 8 parts should produce at least 3 distinct timing offsets
    expect(values.size).toBeGreaterThanOrEqual(3);
  });

  it("is decorrelated from velocity humanize", () => {
    // Timing jitter and velocity jitter should be independent.
    // Check that for a range of inputs, the correlation is weak.
    const timingValues: number[] = [];
    const velocityValues: number[] = [];
    for (let m = 0; m < 20; m++) {
      const mst = m * 2.3;
      timingValues.push(timingHumanize(mst, 1.0, 0));
      velocityValues.push(velocityHumanize(mst, 1.0));
    }
    // Compute Pearson correlation (should be close to 0)
    const n = timingValues.length;
    const meanT = timingValues.reduce((s, v) => s + v, 0) / n;
    const meanV = velocityValues.reduce((s, v) => s + v, 0) / n;
    let num = 0,
      denT = 0,
      denV = 0;
    for (let i = 0; i < n; i++) {
      const dt = timingValues[i]! - meanT;
      const dv = velocityValues[i]! - meanV;
      num += dt * dv;
      denT += dt * dt;
      denV += dv * dv;
    }
    const den = Math.sqrt(denT * denV);
    const corr = den === 0 ? 0 : num / den;
    // Weak correlation: |r| < 0.5
    expect(Math.abs(corr)).toBeLessThan(0.5);
  });

  it("varies across different measures", () => {
    const values = new Set<number>();
    for (let m = 0; m < 20; m++) {
      values.add(timingHumanize(m * 2.4, 0, 0));
    }
    expect(values.size).toBeGreaterThanOrEqual(2);
  });
});

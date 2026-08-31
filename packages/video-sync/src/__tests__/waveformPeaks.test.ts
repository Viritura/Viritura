import { describe, expect, it } from "vitest";
import { computePeaks, peaksForRange, PEAK_BUCKETS_PER_SECOND } from "../waveformPeaks";

/** A sine at `hz`, one second long. */
function sine(hz: number, sampleRate: number, seconds = 1, amplitude = 1): Float32Array {
  const data = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < data.length; i += 1) {
    data[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return data;
}

describe("computePeaks", () => {
  it("produces one min/max pair per bucket", () => {
    const peaks = computePeaks([sine(440, 48000)], 48000, 100);
    expect(peaks.secondsPerBucket).toBeCloseTo(0.01, 12);
    expect(peaks.peaks.length).toBe(100 * 2);
  });

  it("captures the envelope of a full-scale tone", () => {
    const { peaks } = computePeaks([sine(440, 48000)], 48000, 100);
    for (let bucket = 0; bucket < 100; bucket += 1) {
      expect(peaks[bucket * 2]).toBeLessThan(-0.9);
      expect(peaks[bucket * 2 + 1]).toBeGreaterThan(0.9);
    }
  });

  it("keeps an asymmetric transient asymmetric", () => {
    // The kind of thing a composer spots on: a one-sided thump.
    const data = new Float32Array(1000);
    data[500] = 0.8;
    const { peaks } = computePeaks([data], 1000, 10);
    expect(peaks[5 * 2 + 1]).toBeCloseTo(0.8, 6);
    expect(peaks[5 * 2]).toBe(0);
  });

  it("does not lose a hard-panned effect", () => {
    // Left silent, right loud — averaging must not hide it, and taking only the
    // first channel would.
    const silent = new Float32Array(1000);
    const loud = new Float32Array(1000).fill(1);
    const { peaks } = computePeaks([silent, loud], 1000, 10);
    expect(peaks[1]).toBeCloseTo(0.5, 6);
  });

  it("survives empty audio", () => {
    expect(computePeaks([], 48000).peaks.length).toBe(2);
    expect(computePeaks([new Float32Array(0)], 48000).peaks.length).toBe(2);
  });

  it("covers the whole clip with no leftover samples", () => {
    // A duration that is not a whole number of buckets: the last bucket must
    // still reach the end, or the waveform stops short of the last frame.
    const sampleRate = 48000;
    const data = new Float32Array(Math.round(sampleRate * 1.234)).fill(0.5);
    const { peaks, secondsPerBucket } = computePeaks([data], sampleRate, PEAK_BUCKETS_PER_SECOND);
    const bucketCount = peaks.length / 2;
    expect(bucketCount * secondsPerBucket).toBeGreaterThanOrEqual(1.234);
    expect(peaks[(bucketCount - 1) * 2 + 1]).toBeCloseTo(0.5, 6);
  });
});

describe("peaksForRange", () => {
  const data = computePeaks([sine(10, 1000, 2)], 1000, 100);

  it("returns exactly the requested number of columns", () => {
    expect(peaksForRange(data, 0, 2, 300).length).toBe(600);
  });

  it("holds the level rather than gapping when zoomed past the stored detail", () => {
    // 20 ms of audio across 100 columns: each column is a fraction of a bucket.
    const columns = peaksForRange(data, 0.5, 0.52, 100);
    const anyDrawn = Array.from(columns).some((value) => value !== 0);
    expect(anyDrawn).toBe(true);
  });

  it("is empty for a degenerate range", () => {
    expect(peaksForRange(data, 1, 1, 100).every((value) => value === 0)).toBe(true);
    expect(peaksForRange(data, 0, 2, 0).length).toBe(0);
  });

  it("reads zero outside the clip rather than wrapping", () => {
    const columns = peaksForRange(data, 5, 6, 10);
    expect(Array.from(columns).every((value) => value === 0)).toBe(true);
  });
});

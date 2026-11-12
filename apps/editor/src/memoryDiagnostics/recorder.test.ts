import { describe, expect, it } from "vitest";
import { MemoryRecorder, type MemorySample } from "./recorder";

const MIB = 1024 * 1024;
const INITIAL: MemorySample = {
  timestamp: 0,
  heapUsedBytes: 100 * MIB,
  heapLimitBytes: 2048 * MIB,
  mainWasmBytes: 32 * MIB,
  workerWasmBytes: 64 * MIB,
  workerSampleAgeMs: 0,
  canvasCount: 1,
  canvasPixelBytes: 1024,
  parts: 1,
  measures: 4,
  mnxCharacters: 1000,
  dirty: false,
  documentGeneration: 1,
  tilesCached: 2,
  tilesRendered: 0,
  retainedTileBytes: 1024,
  renderCommandCount: 200,
  layoutMs: 20,
  serializeMs: 1,
  hidden: false,
};

describe("memory pressure recorder", () => {
  it.each([
    { heapUsedBytes: 512 * MIB },
    { heapUsedBytes: 400 * MIB, heapLimitBytes: 500 * MIB },
    { mainWasmBytes: 512 * MIB },
    { workerWasmBytes: 512 * MIB },
  ])("requires sustained pressure and rate limits warnings: %o", (overrides) => {
    const recorder = new MemoryRecorder("test-build");
    const high = { ...INITIAL, ...overrides };
    expect(recorder.sample(high)).toBeNull();
    expect(recorder.sample({ ...high, timestamp: 10000 })).toBeNull();
    expect(recorder.sample({ ...high, timestamp: 20000 })?.reason).toBe("high-memory");
    expect(recorder.sample({ ...high, timestamp: 30000 })).toBeNull();
    expect(recorder.sample({ ...high, timestamp: 320000 })?.reason).toBe("high-memory");
  });

  it("resets the sustained-pressure count after a transient spike", () => {
    const recorder = new MemoryRecorder("test");
    recorder.sample({ ...INITIAL, heapUsedBytes: 600 * MIB });
    recorder.sample({ ...INITIAL, timestamp: 10000 });
    expect(recorder.sample({ ...INITIAL, timestamp: 20000, heapUsedBytes: 600 * MIB })).toBeNull();
    expect(recorder.sample({ ...INITIAL, timestamp: 30000, heapUsedBytes: 600 * MIB })).toBeNull();
  });

  it.each([
    { before: 511, after: 511, limit: 2048 },
    { before: 400, after: 400, limit: 501 },
    { before: 300, after: 428, limit: 2048 },
    { before: 200, after: 327, limit: 2048 },
  ])("does not warn just below pressure or growth thresholds: %o", ({ before, after, limit }) => {
    const recorder = new MemoryRecorder("test");
    recorder.sample({ ...INITIAL, heapUsedBytes: before * MIB, heapLimitBytes: limit * MIB });
    for (let index = 1; index <= 12; index++) {
      expect(
        recorder.sample({
          ...INITIAL,
          timestamp: index * 10000,
          heapUsedBytes: after * MIB,
          heapLimitBytes: limit * MIB,
        }),
      ).toBeNull();
    }
  });

  it.each(["heapUsedBytes", "mainWasmBytes", "workerWasmBytes"] as const)(
    "detects growth in %s only after two minutes",
    (key) => {
      const recorder = new MemoryRecorder("test");
      recorder.sample({ ...INITIAL, [key]: 256 * MIB });
      expect(recorder.sample({ ...INITIAL, timestamp: 119999, [key]: 384 * MIB })).toBeNull();
      expect(recorder.sample({ ...INITIAL, timestamp: 120000, [key]: 384 * MIB })?.reason).toBe("rapid-growth");
    },
  );

  it("does not mistake document switches or unsupported readings for growth", () => {
    const recorder = new MemoryRecorder("test");
    recorder.sample(INITIAL);
    expect(
      recorder.sample({
        ...INITIAL,
        timestamp: 120000,
        documentGeneration: 2,
        heapUsedBytes: 300 * MIB,
      }),
    ).toBeNull();
    const unavailable = new MemoryRecorder("test");
    for (let index = 0; index < 70; index++) {
      expect(
        unavailable.sample({
          ...INITIAL,
          timestamp: index * 10000,
          heapUsedBytes: null,
          heapLimitBytes: null,
          mainWasmBytes: null,
          workerWasmBytes: null,
        }),
      ).toBeNull();
    }
  });

  it("bounds history without changing an already captured incident", () => {
    const recorder = new MemoryRecorder("test");
    for (let index = 0; index < 3; index++) {
      recorder.sample({ ...INITIAL, timestamp: index * 10000, heapUsedBytes: 600 * MIB });
    }
    const incident = recorder.report("high-memory");
    for (let index = 3; index < 1000; index++) recorder.sample({ ...INITIAL, timestamp: index * 10000 });
    expect(incident.samples).toHaveLength(3);
    const report = recorder.report("manual");
    expect(report.samples).toHaveLength(60);
    expect(report.samples[0]?.timestamp).toBe(9400000);
    expect(JSON.stringify(report).length).toBeLessThan(128 * 1024);
  });
});

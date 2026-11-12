const MIB = 1024 * 1024;
const HISTORY_LIMIT = 60;
const GROWTH_WINDOW_MS = 2 * 60 * 1000;
const WARNING_COOLDOWN_MS = 5 * 60 * 1000;

export interface MemorySample {
  timestamp: number;
  heapUsedBytes: number | null;
  heapLimitBytes: number | null;
  mainWasmBytes: number | null;
  workerWasmBytes: number | null;
  workerSampleAgeMs: number | null;
  canvasCount: number;
  canvasPixelBytes: number;
  parts: number;
  measures: number;
  mnxCharacters: number;
  dirty: boolean;
  documentGeneration: number;
  tilesCached: number;
  tilesRendered: number;
  retainedTileBytes: number;
  renderCommandCount: number;
  layoutMs: number;
  serializeMs: number;
  hidden: boolean;
}

export interface MemoryReport {
  version: 1;
  reason: "checkpoint" | "manual" | "high-memory" | "rapid-growth";
  createdAt: string;
  build: string;
  samples: readonly MemorySample[];
}

export class MemoryRecorder {
  private samples: MemorySample[] = [];
  private highSamples = 0;
  private lastWarningAt = -Infinity;

  constructor(private readonly build: string) {}

  sample(sample: MemorySample): MemoryReport | null {
    this.samples.push(sample);
    if (this.samples.length > HISTORY_LIMIT) this.samples.shift();
    const high =
      (sample.heapUsedBytes ?? 0) >= 512 * MIB ||
      (sample.heapLimitBytes !== null &&
        sample.heapLimitBytes > 0 &&
        (sample.heapUsedBytes ?? 0) / sample.heapLimitBytes >= 0.8) ||
      (sample.mainWasmBytes ?? 0) >= 512 * MIB ||
      (sample.workerWasmBytes ?? 0) >= 512 * MIB;
    this.highSamples = high ? this.highSamples + 1 : 0;

    // Compare the same document over a real time window, not a few transient allocations.
    const baseline = this.samples.findLast(
      (previous) =>
        previous.documentGeneration === sample.documentGeneration &&
        sample.timestamp - previous.timestamp >= GROWTH_WINDOW_MS,
    );
    const growing =
      baseline !== undefined &&
      (["heapUsedBytes", "mainWasmBytes", "workerWasmBytes"] as const).some((key) => {
        const before = baseline[key];
        const after = sample[key];
        return before !== null && after !== null && after - before >= 128 * MIB && after >= before * 1.5;
      });

    if ((this.highSamples < 3 && !growing) || sample.timestamp - this.lastWarningAt < WARNING_COOLDOWN_MS) {
      return null;
    }
    this.lastWarningAt = sample.timestamp;
    return this.report(this.highSamples >= 3 ? "high-memory" : "rapid-growth");
  }

  report(reason: MemoryReport["reason"]): MemoryReport {
    return {
      version: 1,
      reason,
      createdAt: new Date().toISOString(),
      build: this.build,
      samples: this.samples.slice(),
    };
  }
}

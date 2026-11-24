const MIB = 1024 * 1024;
const HISTORY_LIMIT = 60;
const MARKER_LIMIT = 40;
const GROWTH_WINDOW_MS = 2 * 60 * 1000;
const WARNING_COOLDOWN_MS = 5 * 60 * 1000;
// Large orchestral scores legitimately sit near 0.5 GiB of heap and worker WASM,
// so absolute limits only catch extreme pressure; growth rules catch leaks.
const HIGH_BYTES = 1536 * MIB;
const SUSTAINED_GROWTH_BYTES = 512 * MIB;
const SUSTAINED_SAMPLES = 3;
/** Worker readings older than this describe an earlier state and are ignored. */
export const STALE_WORKER_SAMPLE_MS = 2 * 60 * 1000;

export type MemoryMarkerKind =
  "document" | "zoom" | "hidden" | "visible" | "playing" | "paused" | "stopped" | "loading";

export interface MemoryMarker {
  timestamp: number;
  kind: MemoryMarkerKind;
  /** Numeric context only, such as the new document generation or zoom level. */
  value?: number;
}

export interface MemorySample {
  timestamp: number;
  uptimeMs: number;
  heapUsedBytes: number | null;
  heapLimitBytes: number | null;
  mainWasmBytes: number | null;
  workerWasmBytes: number | null;
  workerSampleAgeMs: number | null;
  liveSynths: number;
  soundBankBytes: number;
  playbackStatus: string;
  zoom: number;
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
  version: 2;
  reason: "checkpoint" | "manual" | "high-memory" | "rapid-growth" | "sustained-growth";
  createdAt: string;
  pageLoadedAt: string;
  build: string;
  samples: readonly MemorySample[];
  markers: readonly MemoryMarker[];
}

export function isIncidentReason(reason: MemoryReport["reason"]): boolean {
  return reason === "high-memory" || reason === "rapid-growth" || reason === "sustained-growth";
}

/** Worker capacity, or null when the last reading is too old to describe the current state. */
function freshWorkerBytes(sample: MemorySample): number | null {
  return sample.workerSampleAgeMs !== null && sample.workerSampleAgeMs <= STALE_WORKER_SAMPLE_MS
    ? sample.workerWasmBytes
    : null;
}

interface GrowthReading {
  read: (sample: MemorySample) => number | null;
  /**
   * WASM linear memory never shrinks within one instance, so a lower reading
   * means the module was recreated (for example, the layout worker restarting
   * when the score canvas remounts). The fresh instance's first layout regrows
   * to the document's working set, which is not a leak.
   */
  wasm: boolean;
}

const GROWTH_READINGS: readonly GrowthReading[] = [
  { read: (sample) => sample.heapUsedBytes, wasm: false },
  { read: (sample) => sample.mainWasmBytes, wasm: true },
  { read: freshWorkerBytes, wasm: true },
];

export class MemoryRecorder {
  private samples: MemorySample[] = [];
  private markers: MemoryMarker[] = [];
  private highSamples = 0;
  private sustainedSamples = 0;
  private lastWarningAt = -Infinity;
  private documentStartedAt = 0;
  private documentHeapFloor: number | null = null;
  /** Per growth reading: last WASM capacity seen, and the peak of earlier instances for this document. */
  private lastWasmBytes: (number | null)[] = GROWTH_READINGS.map(() => null);
  private priorInstancePeaks: number[] = GROWTH_READINGS.map(() => 0);

  constructor(
    private readonly build: string,
    private readonly pageLoadedAt = performance.timeOrigin,
  ) {}

  mark(kind: MemoryMarkerKind, timestamp = Date.now(), value?: number): void {
    this.markers.push(value === undefined ? { timestamp, kind } : { timestamp, kind, value });
    if (this.markers.length > MARKER_LIMIT) this.markers.shift();
  }

  sample(sample: MemorySample): MemoryReport | null {
    const previous = this.samples.at(-1);
    if (previous && previous.documentGeneration !== sample.documentGeneration) {
      this.mark("document", sample.timestamp, sample.documentGeneration);
    }
    if (previous && previous.zoom !== sample.zoom) this.mark("zoom", sample.timestamp, sample.zoom);
    this.samples.push(sample);
    if (this.samples.length > HISTORY_LIMIT) this.samples.shift();

    const workerBytes = freshWorkerBytes(sample);
    const high =
      (sample.heapUsedBytes ?? 0) >= HIGH_BYTES ||
      (sample.heapLimitBytes !== null &&
        sample.heapLimitBytes > 0 &&
        (sample.heapUsedBytes ?? 0) / sample.heapLimitBytes >= 0.8) ||
      (sample.mainWasmBytes ?? 0) >= HIGH_BYTES ||
      (workerBytes ?? 0) >= HIGH_BYTES;
    this.highSamples = high ? this.highSamples + 1 : 0;

    // Compare the same document over a real time window, not a few transient allocations.
    const baseline = this.samples.findLast(
      (earlier) =>
        earlier.documentGeneration === sample.documentGeneration &&
        sample.timestamp - earlier.timestamp >= GROWTH_WINDOW_MS,
    );
    this.trackWasmInstances(sample, previous);
    const rapid =
      baseline !== undefined &&
      GROWTH_READINGS.some(({ read, wasm }, index) => {
        const reading = read(baseline);
        const after = read(sample);
        if (reading === null || after === null) return false;
        const before = wasm ? Math.max(reading, this.priorInstancePeaks[index] ?? 0) : reading;
        return after - before >= 128 * MIB && after >= before * 1.5;
      });
    const sustained = this.trackSustainedGrowth(sample, previous);

    if ((this.highSamples < 3 && !rapid && !sustained) || sample.timestamp - this.lastWarningAt < WARNING_COOLDOWN_MS) {
      return null;
    }
    this.lastWarningAt = sample.timestamp;
    return this.report(this.highSamples >= 3 ? "high-memory" : rapid ? "rapid-growth" : "sustained-growth");
  }

  private trackWasmInstances(sample: MemorySample, previous: MemorySample | undefined): void {
    if (!previous || previous.documentGeneration !== sample.documentGeneration) {
      this.lastWasmBytes = GROWTH_READINGS.map(() => null);
      this.priorInstancePeaks = GROWTH_READINGS.map(() => 0);
    }
    GROWTH_READINGS.forEach(({ read, wasm }, index) => {
      const bytes = wasm ? read(sample) : null;
      if (bytes === null) return;
      const last = this.lastWasmBytes[index] ?? null;
      if (last !== null && bytes < last) {
        this.priorInstancePeaks[index] = Math.max(this.priorInstancePeaks[index] ?? 0, last);
      }
      this.lastWasmBytes[index] = bytes;
    });
  }

  /**
   * A slow leak never looks "rapid" inside the bounded history, so also compare
   * the heap against the lowest post-load reading for the current document.
   */
  private trackSustainedGrowth(sample: MemorySample, previous: MemorySample | undefined): boolean {
    if (!previous || previous.documentGeneration !== sample.documentGeneration) {
      this.documentStartedAt = sample.timestamp;
      this.documentHeapFloor = null;
      this.sustainedSamples = 0;
    }
    const heap = sample.heapUsedBytes;
    if (heap === null || sample.timestamp - this.documentStartedAt < GROWTH_WINDOW_MS) return false;
    if (this.documentHeapFloor === null || heap < this.documentHeapFloor) this.documentHeapFloor = heap;
    this.sustainedSamples = heap - this.documentHeapFloor >= SUSTAINED_GROWTH_BYTES ? this.sustainedSamples + 1 : 0;
    return this.sustainedSamples >= SUSTAINED_SAMPLES;
  }

  report(reason: MemoryReport["reason"]): MemoryReport {
    return {
      version: 2,
      reason,
      createdAt: new Date().toISOString(),
      pageLoadedAt: new Date(this.pageLoadedAt).toISOString(),
      build: this.build,
      samples: this.samples.slice(),
      markers: this.markers.slice(),
    };
  }
}

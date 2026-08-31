/**
 * Building the picture's waveform from the clip already in memory.
 *
 * The blob has been downloaded to play the video, so the audio needs no second
 * fetch. `decodeAudioData` handles whatever the container holds (AAC in MP4,
 * Vorbis/Opus in WebM) using the same decoders the `<video>` element uses, so
 * anything that plays will also draw.
 *
 * Two things are deliberate. The `AudioContext` is created here and closed
 * immediately: browsers cap the number of live contexts, and holding one open
 * to decode a file once would eventually starve playback. And results are
 * cached against the media's content hash rather than its name, so relinking
 * the same cut under a different filename reuses the envelope while a genuinely
 * different cut does not.
 */

import { computePeaks, PEAK_BUCKETS_PER_SECOND, type PeakData } from "./waveformPeaks";

const cache = new Map<string, PeakData>();

/** Look up an already-built envelope without rebuilding it. */
export function cachedPeaks(key: string): PeakData | undefined {
  return cache.get(key);
}

/** Forget a cached envelope (used when media is detached). */
export function forgetPeaks(key: string): void {
  cache.delete(key);
}

interface DecodeOptions {
  /** Cache key — the media content hash, or the demo source id. */
  readonly key: string;
  readonly bucketsPerSecond?: number;
  /** Injectable for tests; defaults to the module-level worker. */
  readonly reduce?: (channels: Float32Array[], sampleRate: number, bucketsPerSecond: number) => Promise<PeakData>;
}

/**
 * Decode a media blob and reduce it to a drawable envelope.
 *
 * Returns `null` rather than throwing when the clip has no audio track or the
 * runtime cannot decode it: a silent reference cut is a perfectly ordinary
 * thing to be handed, and it should cost the composer a missing waveform, not
 * an error.
 */
export async function buildWaveform(blob: Blob, options: DecodeOptions): Promise<PeakData | null> {
  const cached = cache.get(options.key);
  if (cached) return cached;

  const bucketsPerSecond = options.bucketsPerSecond ?? PEAK_BUCKETS_PER_SECOND;
  const reduce = options.reduce ?? reduceInWorker;

  let decoded: AudioBuffer;
  const context = createDecodeContext();
  if (!context) return null;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    void context.close();
  }

  if (decoded.numberOfChannels === 0) return null;

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    channels.push(decoded.getChannelData(channel));
  }

  const peaks = await reduce(channels, decoded.sampleRate, bucketsPerSecond);
  cache.set(options.key, peaks);
  return peaks;
}

function createDecodeContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  return new AudioContext();
}

/**
 * Hand the PCM to the worker.
 *
 * Falls back to reducing inline where workers are unavailable (older Safari in
 * some embeddings, and jsdom): a brief stall is better than no waveform.
 */
async function reduceInWorker(
  channels: Float32Array[],
  sampleRate: number,
  bucketsPerSecond: number,
): Promise<PeakData> {
  if (typeof Worker === "undefined") return computePeaks(channels, sampleRate, bucketsPerSecond);

  const worker = new Worker(new URL("./waveformWorker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<PeakData>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<PeakData>) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message));
      // getChannelData returns views onto the AudioBuffer's own storage, which
      // cannot be transferred; copy first so the transfer neuters our copy only.
      const buffers = channels.map((channel) => channel.slice().buffer);
      worker.postMessage({ channels: buffers, sampleRate, bucketsPerSecond }, buffers);
    });
  } finally {
    worker.terminate();
  }
}

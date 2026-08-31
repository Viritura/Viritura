/**
 * Peak-building worker.
 *
 * Decoding has to happen on the main thread — Web Audio's `decodeAudioData`
 * is not exposed to workers — but the reduction that follows is a tight loop
 * over millions of samples, and running it inline drops frames on the timeline
 * just as the composer is watching it appear.
 *
 * Channels arrive as transferred buffers, so the main thread's copy is
 * neutered on send and the 50-odd MB of PCM has exactly one owner.
 */

import { computePeaks } from "./waveformPeaks";

interface PeakRequest {
  readonly channels: ArrayBuffer[];
  readonly sampleRate: number;
  readonly bucketsPerSecond: number;
}

self.onmessage = (event: MessageEvent<PeakRequest>) => {
  const { channels, sampleRate, bucketsPerSecond } = event.data;
  const result = computePeaks(
    channels.map((buffer) => new Float32Array(buffer)),
    sampleRate,
    bucketsPerSecond,
  );
  // Transfer the envelope back rather than structured-cloning it; it is small,
  // but the main thread is about to paint with it.
  self.postMessage(result, { transfer: [result.peaks.buffer] });
};

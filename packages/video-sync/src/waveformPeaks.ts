/**
 * Picture-audio peaks.
 *
 * A waveform under the picture ruler is how a composer finds a door slam or a
 * line of dialogue without scrubbing for it, so it is worth having even though
 * the score's own audio is elsewhere.
 *
 * The clip is already in memory as a blob, so this needs no network and no new
 * dependency: `decodeAudioData` gives PCM, and PCM reduces to an envelope. What
 * it must not do is hold on to the PCM. A 150-second stereo clip at 48 kHz is
 * about 58 MB of Float32; the envelope at the resolution below is under 250 kB,
 * and the samples are dropped as soon as it is built.
 *
 * Buckets are min/max pairs rather than an RMS or an absolute peak, because
 * asymmetric transients are exactly the ones a composer is hunting for, and
 * folding them to one number hides them.
 */

/** Resolution of the stored envelope, in buckets per second of audio. */
export const PEAK_BUCKETS_PER_SECOND = 200;

export interface PeakData {
  /** Seconds of audio each bucket covers. */
  readonly secondsPerBucket: number;
  /** Interleaved min/max in -1..1, two entries per bucket. */
  readonly peaks: Float32Array;
}

/**
 * Reduce decoded channels to a min/max envelope.
 *
 * Channels are summed and averaged rather than taken from the left alone: a
 * hard-panned effect that only exists in one channel is still a hit point.
 */
export function computePeaks(
  channels: readonly Float32Array[],
  sampleRate: number,
  bucketsPerSecond: number = PEAK_BUCKETS_PER_SECOND,
): PeakData {
  const secondsPerBucket = 1 / bucketsPerSecond;
  const frameCount = channels[0]?.length ?? 0;
  const bucketCount = Math.max(1, Math.ceil(frameCount / (sampleRate * secondsPerBucket)));
  const peaks = new Float32Array(bucketCount * 2);
  if (frameCount === 0 || channels.length === 0) return { secondsPerBucket, peaks };

  const samplesPerBucket = frameCount / bucketCount;
  const channelCount = channels.length;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = Math.floor(bucket * samplesPerBucket);
    const to = Math.min(frameCount, Math.floor((bucket + 1) * samplesPerBucket));
    let min = 0;
    let max = 0;
    for (let i = from; i < to; i += 1) {
      let sum = 0;
      for (let c = 0; c < channelCount; c += 1) sum += channels[c]![i]!;
      const value = sum / channelCount;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    peaks[bucket * 2] = min;
    peaks[bucket * 2 + 1] = max;
  }

  return { secondsPerBucket, peaks };
}

/**
 * Collapse the stored envelope onto a pixel column range.
 *
 * The renderer asks for exactly as many columns as it has pixels, so zooming in
 * never invents detail the envelope does not have and zooming out never draws
 * more buckets than there are columns to draw them in. Returns interleaved
 * min/max, same as the stored form.
 */
export function peaksForRange(data: PeakData, startSeconds: number, endSeconds: number, columns: number): Float32Array {
  const out = new Float32Array(Math.max(0, columns) * 2);
  if (columns <= 0 || endSeconds <= startSeconds) return out;

  const bucketCount = data.peaks.length / 2;
  const secondsPerColumn = (endSeconds - startSeconds) / columns;

  for (let column = 0; column < columns; column += 1) {
    const columnStart = startSeconds + column * secondsPerColumn;
    const from = Math.floor(columnStart / data.secondsPerBucket);
    // At least one bucket per column: when zoomed past the stored resolution the
    // same bucket repeats, which reads as a held level rather than a gap.
    const to = Math.max(from + 1, Math.ceil((columnStart + secondsPerColumn) / data.secondsPerBucket));

    let min = 0;
    let max = 0;
    for (let bucket = from; bucket < to; bucket += 1) {
      if (bucket < 0 || bucket >= bucketCount) continue;
      const bucketMin = data.peaks[bucket * 2]!;
      const bucketMax = data.peaks[bucket * 2 + 1]!;
      if (bucketMin < min) min = bucketMin;
      if (bucketMax > max) max = bucketMax;
    }
    out[column * 2] = min;
    out[column * 2 + 1] = max;
  }

  return out;
}

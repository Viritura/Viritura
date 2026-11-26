/**
 * Browser-side reference for click qualification. Imported into the page through
 * Vite so the comparison runs next to the rendered PCM instead of shipping
 * millions of samples back to the test runner.
 */

/** One uninterrupted run of the click worklet, in render frames. */
export interface ClickSegment {
  /** Output frame at which `offsetFrame` sounds. */
  readonly anchorFrame: number;
  /** First program frame of the run. */
  readonly offsetFrame: number;
  /** Program frame at which the run was stopped, or `Infinity` if it ran out. */
  readonly stopProgramFrame: number;
}

export interface ResidualReport {
  /** Number of planned clicks subtracted from the capture. */
  readonly clicks: number;
  /** Largest absolute sample left after subtracting every planned click. */
  readonly peak: number;
  /** Output frame of {@link ResidualReport.peak}. */
  readonly peakFrame: number;
}

/**
 * Subtract every planned click voice from `pcm` in place and report what remains.
 * A missing, duplicated, or shifted click leaves a residual on the order of the
 * voice amplitude; a sample-exact render leaves only float rounding noise.
 */
export function subtractPlannedClicks(
  pcm: Float32Array,
  pcmStartFrame: number,
  frames: ArrayLike<number>,
  levels: ArrayLike<number>,
  segments: readonly ClickSegment[],
  voices: readonly Float32Array[],
  gain: number,
): ResidualReport {
  let clicks = 0;
  for (const { anchorFrame, offsetFrame, stopProgramFrame } of segments) {
    const cutoff = Number.isFinite(stopProgramFrame) ? anchorFrame + stopProgramFrame - offsetFrame : Infinity;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]!;
      if (frame < offsetFrame || frame >= stopProgramFrame) continue;
      clicks++;
      const voice = voices[levels[index]!]!;
      const onset = anchorFrame + frame - offsetFrame;
      for (let sample = 0; sample < voice.length; sample++) {
        const output = onset + sample;
        if (output >= cutoff) break;
        const position = output - pcmStartFrame;
        if (position >= 0 && position < pcm.length) pcm[position]! -= voice[sample]! * gain;
      }
    }
  }
  let peak = 0;
  let peakFrame = -1;
  for (let position = 0; position < pcm.length; position++) {
    const value = Math.abs(pcm[position]!);
    if (value > peak) {
      peak = value;
      peakFrame = pcmStartFrame + position;
    }
  }
  return { clicks, peak, peakFrame };
}

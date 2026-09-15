/**
 * Decoded Ogg Vorbis audio.
 *
 * PCM samples are planar Float32 PCM.
 */
export interface DecodedAudio {
  /** The audio sample rate in Hz. */
  readonly sampleRate: number;
  /** One PCM array for each audio channel. */
  readonly channels: Float32Array[];
}

/**
 * SF2-only replacement for the optional Ogg Vorbis decoder used by
 * SpessaSynth when it encounters an SF3 SoundFont.
 */
export class StbVorbis {
  static readonly ready: Promise<void> = Promise.resolve();

  static decode(_data: ArrayBufferLike | Uint8Array<ArrayBufferLike>): DecodedAudio {
    throw new Error("SF3 decoding is unavailable in this Viritura build; only SF2 SoundFonts are supported.");
  }
}

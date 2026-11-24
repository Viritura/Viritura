import { MP3_BITRATES, WAV_BIT_DEPTHS, type AudioEncoding } from "./messages";
import { createWavEncoder } from "./wavEncoder";

export interface AudioStreamEncoder {
  encode(left: Float32Array, right: Float32Array): Uint8Array;
  /** `header`, when present, overwrites the start of the file with final totals. */
  finish(): { tail: Uint8Array; header: Uint8Array | null };
  free(): void;
}

export async function createAudioEncoder(encoding: AudioEncoding, sampleRate: number): Promise<AudioStreamEncoder> {
  if (encoding.format === "wav") {
    if (!WAV_BIT_DEPTHS.includes(encoding.bitDepth)) throw new Error("Unsupported WAV bit depth.");
    return createWavEncoder(sampleRate, encoding.bitDepth);
  }
  if (!MP3_BITRATES.includes(encoding.bitrate)) throw new Error("Unsupported MP3 bitrate.");
  const { default: mp3 } = await import("@audio/encode-mp3");
  const encoder = await mp3({ sampleRate, channels: 2, bitrate: encoding.bitrate });
  return {
    encode: (left, right) => encoder.encode([left, right]),
    finish: () => ({ tail: encoder.flush(), header: encoder.head?.() ?? null }),
    free: () => encoder.free(),
  };
}

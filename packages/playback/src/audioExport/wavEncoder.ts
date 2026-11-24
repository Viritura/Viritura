import type { WavBitDepth } from "./messages";
import type { AudioStreamEncoder } from "./audioEncoding";

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const CHANNELS = 2;
const MAX_RIFF_SIZE = 0xffff_ffff;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Builds the RIFF/WAVE header. Floating-point WAVs carry the extended `fmt `
 * chunk and the `fact` chunk that the WAVE specification requires for
 * non-PCM formats.
 */
function wavHeader(sampleRate: number, bitDepth: WavBitDepth, dataBytes: number): Uint8Array {
  const float = bitDepth === 32;
  const header = new Uint8Array(float ? 58 : 44);
  const view = new DataView(header.buffer);
  const blockAlign = CHANNELS * (bitDepth / 8);
  const fmtSize = float ? 18 : 16;
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, header.length - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, float ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  let offset = 36;
  if (float) {
    view.setUint16(offset, 0, true);
    writeAscii(view, offset + 2, "fact");
    view.setUint32(offset + 6, 4, true);
    view.setUint32(offset + 10, dataBytes / blockAlign, true);
    offset += 14;
  }
  writeAscii(view, offset, "data");
  view.setUint32(offset + 4, dataBytes, true);
  return header;
}

/** Deterministic xorshift32 source for reproducible dither. */
function createNoise(): () => number {
  let state = 0x9e37_79b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Streams interleaved little-endian WAV data. The first chunk reserves space
 * for the header, which `finish` returns with the final sizes.
 */
export function createWavEncoder(sampleRate: number, bitDepth: WavBitDepth): AudioStreamEncoder {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = CHANNELS * bytesPerSample;
  const headerBytes = wavHeader(sampleRate, bitDepth, 0).length;
  const noise = createNoise();
  let dataBytes = 0;
  let started = false;

  // Standard mastering practice: TPDF dither of ±1 LSB before truncating to
  // 16 bits decorrelates quantization error from the signal. Digital silence
  // stays silent.
  const toInt16 = (sample: number): number => {
    if (sample === 0) return 0;
    const value = Math.round(sample * 32_767 + noise() - noise());
    return Math.max(-32_768, Math.min(32_767, value));
  };
  const toInt24 = (sample: number): number => Math.max(-8_388_608, Math.min(8_388_607, Math.round(sample * 8_388_607)));

  const writeSample = (view: DataView, offset: number, sample: number): void => {
    if (bitDepth === 32) {
      view.setFloat32(offset, sample, true);
    } else if (bitDepth === 16) {
      view.setInt16(offset, toInt16(sample), true);
    } else {
      const value = toInt24(sample);
      view.setUint8(offset, value & 0xff);
      view.setUint8(offset + 1, (value >> 8) & 0xff);
      view.setUint8(offset + 2, (value >> 16) & 0xff);
    }
  };

  return {
    encode(left, right) {
      const prefix = started ? 0 : headerBytes;
      const size = left.length * blockAlign;
      if (headerBytes - 8 + dataBytes + size > MAX_RIFF_SIZE) {
        throw new Error("The score is too long to export as WAV.");
      }
      const chunk = new Uint8Array(prefix + size);
      const view = new DataView(chunk.buffer);
      for (let i = 0; i < left.length; i++) {
        const offset = prefix + i * blockAlign;
        writeSample(view, offset, left[i]!);
        writeSample(view, offset + bytesPerSample, right[i]!);
      }
      started = true;
      dataBytes += size;
      return chunk;
    },
    finish() {
      return {
        tail: started ? new Uint8Array(0) : new Uint8Array(headerBytes),
        header: wavHeader(sampleRate, bitDepth, dataBytes),
      };
    },
    free() {},
  };
}

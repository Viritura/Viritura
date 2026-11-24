import { describe, expect, it } from "vitest";
import {
  CompressorCurve,
  PartitionedConvolver,
  StereoBiquad,
  StereoCompressor,
  convolverNormalizationScale,
  decodeWav,
} from "./index";

const RATE = 44_100;
const db = (linear: number) => 20 * Math.log10(linear);

function sine(frequency: number, frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * frequency * i) / RATE));
}

function rms(data: Float32Array): number {
  return Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
}

function noise(frames: number, seed: number): Float32Array {
  let state = seed;
  return Float32Array.from({ length: frames }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 1_073_741_824 - 1;
  });
}

describe("offline DSP", () => {
  it("uses the linear Web Audio Q factor for the high-pass cutoff", () => {
    const frequency = 1_000;
    const input = sine(frequency, RATE);
    const right = input.slice();
    new StereoBiquad({ type: "highpass", frequency, Q: Math.SQRT1_2 }, RATE).process(input, right);
    expect(db(rms(input.subarray(RATE / 2)) / rms(sine(frequency, RATE).subarray(RATE / 2)))).toBeCloseTo(-3, 0);
  });

  it("boosts only the treble with the air EQ high shelf", () => {
    const gainAt = (frequency: number) => {
      const left = sine(frequency, RATE);
      const right = left.slice();
      new StereoBiquad({ type: "highshelf", frequency: 8_000, gain: 6 }, RATE).process(left, right);
      return db(rms(left.subarray(RATE / 2)) / rms(sine(frequency, RATE).subarray(RATE / 2)));
    };
    expect(gainAt(100)).toBeCloseTo(0, 1);
    expect(gainAt(18_000)).toBeCloseTo(6, 0);
  });

  it("matches a normalized direct convolution across partitions", () => {
    const block = 64;
    const ir = { channels: [noise(150, 3), noise(150, 7)] };
    const inputs = [noise(block * 5, 11), noise(block * 5, 13)];
    const convolver = new PartitionedConvolver(ir, RATE, block);
    const outputs = [new Float32Array(block * 5), new Float32Array(block * 5)];
    for (let start = 0; start < block * 5; start += block) {
      convolver.process(
        inputs[0]!.subarray(start, start + block),
        inputs[1]!.subarray(start, start + block),
        outputs[0]!.subarray(start, start + block),
        outputs[1]!.subarray(start, start + block),
      );
    }
    const scale = convolverNormalizationScale(ir, RATE);
    for (let channel = 0; channel < 2; channel++) {
      for (let n = 0; n < block * 5; n++) {
        let expected = 0;
        for (let k = 0; k <= Math.min(n, 149); k++) expected += inputs[channel]![n - k]! * ir.channels[channel]![k]!;
        expect(outputs[channel]![n]).toBeCloseTo(expected * scale, 4);
      }
    }
  });

  it("follows the limiter curve: unity below threshold and the ratio slope above the knee", () => {
    const curve = new CompressorCurve({ thresholdDb: -8, kneeDb: 6, ratio: 12 });
    expect(curve.apply(10 ** (-20 / 20))).toBeCloseTo(10 ** (-20 / 20), 6);
    expect((db(curve.apply(10 ** (6 / 20))) - db(curve.apply(1))) / 6).toBeCloseTo(1 / 12, 3);
  });

  it("reduces a loud signal and keeps it bounded", () => {
    const loud = sine(440, RATE).map((sample) => sample * 2);
    const right = loud.slice();
    new StereoCompressor({ thresholdDb: -8, kneeDb: 6, ratio: 12, attack: 0.002, release: 0.18 }, RATE).process(
      loud,
      right,
    );
    const settled = rms(loud.subarray(RATE / 2));
    expect(settled).toBeLessThan(rms(sine(440, RATE).map((sample) => sample * 2)) / 2);
    expect(settled).toBeGreaterThan(0.1);
  });

  it("decodes 16-bit stereo PCM", () => {
    const view = new DataView(new ArrayBuffer(52));
    [..."RIFF"].forEach((char, i) => view.setUint8(i, char.charCodeAt(0)));
    view.setUint32(4, 44, true);
    [..."WAVEfmt "].forEach((char, i) => view.setUint8(8 + i, char.charCodeAt(0)));
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 48_000, true);
    view.setUint32(28, 192_000, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    [..."data"].forEach((char, i) => view.setUint8(36 + i, char.charCodeAt(0)));
    view.setUint32(40, 8, true);
    [16_384, -32_768, 0, 32_767].forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));

    const decoded = decodeWav(view.buffer);
    expect(decoded.sampleRate).toBe(48_000);
    expect([...decoded.channels[0]!]).toEqual([0.5, 0]);
    expect(decoded.channels[1]![0]).toBe(-1);
    expect(decoded.channels[1]![1]).toBeCloseTo(1, 4);
  });
});

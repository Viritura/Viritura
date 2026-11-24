import { describe, expect, it } from "vitest";
import { createWavEncoder } from "./wavEncoder";

function encodeWav(bitDepth: 16 | 24 | 32, left: number[], right: number[]): DataView {
  const encoder = createWavEncoder(44_100, bitDepth);
  const first = encoder.encode(new Float32Array(left.slice(0, 1)), new Float32Array(right.slice(0, 1)));
  const second = encoder.encode(new Float32Array(left.slice(1)), new Float32Array(right.slice(1)));
  const { tail, header } = encoder.finish();
  const bytes = new Uint8Array(first.length + second.length + tail.length);
  bytes.set(first);
  bytes.set(second, first.length);
  bytes.set(header!);
  return new DataView(bytes.buffer);
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, offset, length));
}

describe("WAV encoding", () => {
  it("writes a 24-bit PCM header with final sizes and full-scale interleaved samples", () => {
    const view = encodeWav(24, [1, 0.5, 0], [-1, -0.5, 0]);

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
    expect(ascii(view, 8, 8)).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(28, true)).toBe(44_100 * 6);
    expect(view.getUint16(32, true)).toBe(6);
    expect(view.getUint16(34, true)).toBe(24);
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(18);
    const int24 = (offset: number) =>
      view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
    expect([0, 3, 6, 9, 12, 15].map((i) => int24(44 + i))).toEqual([
      8_388_607, -8_388_607, 4_194_304, -4_194_303, 0, 0,
    ]);
  });

  it("writes IEEE float data with the fact chunk required for non-PCM WAVs", () => {
    const view = encodeWav(32, [0.25, -0.75], [1, 0]);

    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint32(16, true)).toBe(18);
    expect(ascii(view, 38, 4)).toBe("fact");
    expect(view.getUint32(46, true)).toBe(2);
    expect(ascii(view, 50, 4)).toBe("data");
    expect(view.getUint32(54, true)).toBe(16);
    expect([0, 4, 8, 12].map((i) => view.getFloat32(58 + i, true))).toEqual([0.25, 1, -0.75, 0]);
  });

  it("dithers 16-bit samples by at most one step and keeps digital silence silent", () => {
    const view = encodeWav(16, [0.5, 0, -1], [0, 1, -0.25]);

    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    const samples = [0, 2, 4, 6, 8, 10].map((i) => view.getInt16(44 + i, true));
    const expected = [16_384, 0, 0, 32_767, -32_767, -8_192];
    samples.forEach((sample, index) => expect(Math.abs(sample - expected[index]!)).toBeLessThanOrEqual(1));
    expect([samples[1], samples[2]]).toEqual([0, 0]);
  });
});

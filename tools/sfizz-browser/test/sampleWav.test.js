import assert from "node:assert/strict";
import test from "node:test";
import { validateWavBytes } from "../src/sampleWav.js";

test("accepts bounded PCM16 stereo WAV layout used by VSCO samples", () => {
  const metadata = validateWavBytes(makeWav({ bitsPerSample: 16, channels: 2, format: 1 }), "Glockenspiel.wav");

  assert.deepEqual(metadata, {
    bitsPerSample: 16,
    blockAlign: 4,
    byteRate: 176400,
    channels: 2,
    dataBytes: 8,
    format: 1,
    sampleRate: 44100,
  });
});

test("rejects corrupt and unsupported WAV before sfizz load success is reported", () => {
  assert.throws(() => validateWavBytes(new Uint8Array(16), "bad.wav"), /Corrupt WAV sample bad\.wav/);
  assert.throws(
    () => validateWavBytes(makeWav({ bitsPerSample: 16, channels: 6, format: 1 }), "surround.wav"),
    /Unsupported WAV sample surround\.wav: 6 channels/,
  );
  assert.throws(
    () => validateWavBytes(makeWav({ bitsPerSample: 8, channels: 1, format: 1 }), "pcm8.wav"),
    /Unsupported WAV sample pcm8\.wav: format 1 with 8-bit/,
  );
});

test("rejects data outside the RIFF boundary even when bytes exist in the file", () => {
  const bytes = makeWav({ bitsPerSample: 16, channels: 2, format: 1 });
  new DataView(bytes.buffer).setUint32(4, bytes.length - 10, true);
  assert.throws(() => validateWavBytes(bytes), /chunk extends/);
  new DataView(bytes.buffer).setUint32(4, 0, true);
  assert.throws(() => validateWavBytes(bytes), /RIFF size/);
});

function makeWav({ bitsPerSample, channels, format }) {
  const sampleRate = 44100;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = blockAlign * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function writeAscii(bytes, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

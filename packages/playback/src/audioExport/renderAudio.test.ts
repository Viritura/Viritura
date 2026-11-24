import { describe, expect, it, vi } from "vitest";
import { BasicSoundBank, GeneratorTypes, SoundBankLoader } from "spessasynth_core";
import type { Score } from "@viritura/core";
import { renderScoreAudio } from "./renderAudio";
import { planStage } from "./stagePlan";
import { resolveScorePlaybackParts } from "../soundProfileRuntime";
import type { AudioEncoding } from "./messages";

const MP3: AudioEncoding = { format: "mp3", bitrate: 192 };

const pcm = vi.hoisted(() => ({ energy: [0, 0] }));
vi.mock("@audio/encode-mp3", async (importOriginal) => {
  const { default: createEncoder } = await importOriginal<typeof import("@audio/encode-mp3")>();
  return {
    default: async (...args: Parameters<typeof createEncoder>) => {
      const encoder = await createEncoder(...args);
      const encode = encoder.encode.bind(encoder);
      encoder.encode = (channels) => {
        channels.forEach((channel, index) => {
          for (const sample of channel) pcm.energy[index]! += sample * sample;
        });
        return encode(channels);
      };
      return encoder;
    },
  };
});

function scoreWithNote(silent = false): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  silent
                    ? { type: "event", duration: { base: "half" }, rest: {} }
                    : {
                        type: "event",
                        duration: { base: "half" },
                        notes: [{ pitch: { step: "C", octave: 4 } }],
                      },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function impulseWav(seconds: number, sampleRate = 44_100): ArrayBuffer {
  const frames = Math.round(seconds * sampleRate);
  const view = new DataView(new ArrayBuffer(44 + frames * 4));
  const ascii = (offset: number, text: string) =>
    [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 4, true);
  let seed = 1;
  for (let frame = 0; frame < frames; frame++) {
    const decay = Math.exp((-6 * frame) / frames);
    for (let channel = 0; channel < 2; channel++) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      view.setInt16(44 + frame * 4 + channel * 2, Math.round((seed / 1_073_741_824 - 1) * decay * 20_000), true);
    }
  }
  return view.buffer;
}

function wavFrames(bytes: Uint8Array): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const frames = (bytes.length - 58) / 8;
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  for (let frame = 0; frame < frames; frame++) {
    channels[0]![frame] = view.getFloat32(58 + frame * 8, true);
    channels[1]![frame] = view.getFloat32(62 + frame * 8, true);
  }
  return channels;
}

const FLOAT_WAV: AudioEncoding = { format: "wav", bitDepth: 32 };

describe("audio rendering", () => {
  it("adds the playback room and master chain when effects are requested", async () => {
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    const dry = wavFrames((await renderScoreAudio(scoreWithNote(), soundfont, FLOAT_WAV, () => {})).bytes);
    const effects = {
      reverb: { impulse: impulseWav(1), wet: 0.5 },
      airEqGainDb: 2.5,
      limiterThresholdDb: -8,
      limiterRatio: 12,
    };
    const wet = wavFrames(
      (await renderScoreAudio(scoreWithNote(), soundfont, FLOAT_WAV, () => {}, undefined, { effects })).bytes,
    );

    // The room's tail sounds after the dry note has died away.
    expect(wet[0]!.length).toBeGreaterThan(dry[0]!.length + 44_100);
    const lastSound = (channel: Float32Array) => channel.findLastIndex((sample) => Math.abs(sample) > 1e-4);
    expect(lastSound(wet[0]!)).toBeGreaterThan(lastSound(dry[0]!) + 0.3 * 44_100);
    expect(wet[0]!.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(1);
  });

  it("attenuates parts seated farther from the listener", async () => {
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    const levels: number[] = [];
    for (const y of [0.5, 4]) {
      pcm.energy = [0, 0];
      await renderScoreAudio(scoreWithNote(), soundfont, MP3, () => {}, undefined, {
        stage: { listener: { x: 0, y: 0 }, positions: [{ x: 0, y }], layerPans: [null] },
      });
      levels.push(pcm.energy[0]! + pcm.energy[1]!);
    }
    expect(levels[1]).toBeLessThan(levels[0]! * 0.8);
  });
  it("renders each orchestra section through its own synth sharing one SoundFont", async () => {
    const score = scoreWithNote();
    score.parts[0]!.name = "Violin";
    score.parts.push({ ...structuredClone(score.parts[0]!), name: "Trumpet" });
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    expect(planStage(resolveScorePlaybackParts(score), undefined, undefined).sections).toHaveLength(2);
    const energies: number[] = [];
    for (const solo of [0, 1]) {
      pcm.energy = [0, 0];
      await renderScoreAudio(
        score,
        soundfont,
        MP3,
        () => {},
        [0, 1].map((index) => ({ volume: 1, pan: 0, muted: index !== solo, ensembleEnabled: false })),
      );
      energies.push(pcm.energy[0]! + pcm.energy[1]!);
    }
    expect(energies[0]).toBeGreaterThan(0);
    expect(energies[1]).toBeGreaterThan(0);
  });

  it("encodes a complete score into stereo MP3 and reports progress", async () => {
    const progress = vi.fn();
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    const result = await renderScoreAudio(scoreWithNote(), soundfont, MP3, progress);
    const silent = await renderScoreAudio(scoreWithNote(true), soundfont, MP3, () => {});

    expect(result.bytes[0]).toBe(0xff);
    expect(result.bytes[1]! & 0xe0).toBe(0xe0);
    expect(result.bytes.length).toBeGreaterThan(90_000);
    expect(result.bytes).not.toEqual(silent.bytes);
    expect(result.warnings).toEqual([]);
    const values = progress.mock.calls.map(([value]) => value);
    expect(values.at(-1)).toBe(1);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1]!)).toBe(true);
  });

  it("rejects a document with no playable duration", async () => {
    const empty: Score = { mnx: { version: 1 }, global: { measures: [] }, parts: [] };
    await expect(renderScoreAudio(empty, new ArrayBuffer(0), MP3, () => {})).rejects.toThrow("no playable duration");
  });

  it("keeps rendering when a sound's release lasts longer than two seconds", async () => {
    const bank = SoundBankLoader.fromArrayBuffer(BasicSoundBank.getSampleSoundBankFile());
    bank.instruments[0]!.globalZone.setGenerator(GeneratorTypes.releaseVolEnv, 3_000);
    const result = await renderScoreAudio(scoreWithNote(), bank.writeSF2(), MP3, () => {});

    expect(result.bytes.length).toBeGreaterThan(150_000);
    expect(result.warnings).toEqual([]);
  });

  it("warns when a final release exceeds the 30-second limit", async () => {
    const bank = SoundBankLoader.fromArrayBuffer(BasicSoundBank.getSampleSoundBankFile());
    bank.instruments[0]!.globalZone.setGenerator(GeneratorTypes.releaseVolEnv, 7_200);
    const result = await renderScoreAudio(scoreWithNote(), bank.writeSF2(), MP3, () => {});

    expect(result.bytes.length).toBeGreaterThan(760_000);
    expect(result.bytes.length).toBeLessThan(775_000);
    expect(result.warnings).toEqual(["The final sound was cut off after a 30-second release."]);
  });

  it("includes the derived global chord lane", async () => {
    const score = scoreWithNote(true);
    score.global.measures[0]!.chordSymbols = [{ position: { fraction: [0, 1] }, root: { step: "C" } }];
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    const chords = await renderScoreAudio(score, soundfont, MP3, () => {});
    const silent = await renderScoreAudio(scoreWithNote(true), soundfont, MP3, () => {});

    expect(chords.bytes).not.toEqual(silent.bytes);
  });

  it.each(["mute", "zero fader"] as const)("silences the chords track for %s", async (reason) => {
    const score = scoreWithNote(true);
    score.global.measures[0]!.chordSymbols = [{ position: { fraction: [0, 1] }, root: { step: "C" } }];
    const mix = [
      { volume: 1, pan: 0, muted: false, ensembleEnabled: true },
      { volume: reason === "zero fader" ? 0 : 1, pan: 0, muted: reason === "mute", ensembleEnabled: true },
    ];
    pcm.energy = [0, 0];
    const result = await renderScoreAudio(score, BasicSoundBank.getSampleSoundBankFile(), MP3, () => {}, mix);
    expect(result.bytes.length).toBeGreaterThan(90_000);
    expect(pcm.energy).toEqual([0, 0]);
  });

  it("preserves linear fader attenuation and boosts without clipping gains at unity", async () => {
    const amplitudes: number[] = [];
    for (const volume of [1, 0.25, 2]) {
      pcm.energy = [0, 0];
      await renderScoreAudio(scoreWithNote(), BasicSoundBank.getSampleSoundBankFile(), MP3, () => {}, [
        { volume, pan: 0, muted: false, ensembleEnabled: true },
      ]);
      amplitudes.push(Math.sqrt(pcm.energy[0]! + pcm.energy[1]!));
    }
    expect(amplitudes[0]).toBeGreaterThan(0);
    expect(amplitudes[1]! / amplitudes[0]!).toBeCloseTo(0.25, 2);
    expect(amplitudes[2]! / amplitudes[0]!).toBeCloseTo(2, 2);
  });

  it("applies the mixer pan to the rendered stereo channels", async () => {
    const score = scoreWithNote();
    score.parts[0]!._x = { viritura: { spatial: { x: 0, y: 0 } } };
    for (const pan of [-1, 1]) {
      pcm.energy = [0, 0];
      await renderScoreAudio(score, BasicSoundBank.getSampleSoundBankFile(), MP3, () => {}, [
        { volume: 1, pan, muted: false, ensembleEnabled: true },
      ]);
      const louder = pan === -1 ? 0 : 1;
      expect(pcm.energy[louder]).toBeGreaterThan(pcm.energy[1 - louder]! * 3);
    }
  });

  it("rejects a stale mixer roster instead of exporting an incorrect mix", async () => {
    await expect(renderScoreAudio(scoreWithNote(), new ArrayBuffer(0), MP3, () => {}, [])).rejects.toThrow(
      "mixer settings do not match",
    );
  });

  it("uses the requested MP3 bitrate", async () => {
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    const low = await renderScoreAudio(scoreWithNote(), soundfont, { format: "mp3", bitrate: 128 }, () => {});
    const high = await renderScoreAudio(scoreWithNote(), soundfont, { format: "mp3", bitrate: 320 }, () => {});

    expect(high.bytes.length / low.bytes.length).toBeCloseTo(320 / 128, 1);
  });

  it("renders the same audio to WAV at every bit depth", async () => {
    const soundfont = BasicSoundBank.getSampleSoundBankFile();
    const peaks: number[] = [];
    let frames: number | undefined;
    for (const bitDepth of [16, 24, 32] as const) {
      const { bytes } = await renderScoreAudio(scoreWithNote(), soundfont, { format: "wav", bitDepth }, () => {});
      const view = new DataView(bytes.buffer);
      const dataOffset = bitDepth === 32 ? 58 : 44;
      const blockAlign = (bitDepth / 8) * 2;
      expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
      expect(view.getUint32(dataOffset - 4, true)).toBe(bytes.length - dataOffset);
      frames ??= (bytes.length - dataOffset) / blockAlign;
      expect((bytes.length - dataOffset) / blockAlign).toBe(frames);
      let peak = 0;
      for (let offset = dataOffset; offset < bytes.length; offset += bitDepth / 8) {
        const sample =
          bitDepth === 32
            ? view.getFloat32(offset, true)
            : bitDepth === 16
              ? view.getInt16(offset, true) / 32_767
              : (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) /
                8_388_607;
        peak = Math.max(peak, Math.abs(sample));
      }
      peaks.push(peak);
    }
    expect(frames).toBeGreaterThanOrEqual(4 * 44_100);
    expect(peaks[0]).toBeGreaterThan(0.01);
    expect(peaks[1]).toBeCloseTo(peaks[2]!, 5);
    expect(peaks[0]).toBeCloseTo(peaks[2]!, 3);
  });
});

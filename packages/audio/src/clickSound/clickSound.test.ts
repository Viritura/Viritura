import { describe, expect, it } from "vitest";
import { CLICK_SOUNDS, synthesizeClickVoices } from "./index";

describe("synthesized click sounds", () => {
  it.each([44_100, 48_000])("generates distinct short, bounded voices at %i Hz", (sampleRate) => {
    const tick = synthesizeClickVoices(sampleRate, "tick");
    const woodblock = synthesizeClickVoices(sampleRate, "woodblock");
    const oscillator = synthesizeClickVoices(sampleRate, "oscillator");

    for (const sound of CLICK_SOUNDS) {
      const voices = synthesizeClickVoices(sampleRate, sound);
      const peaks = voices.map((voice) => Math.max(...voice.map(Math.abs)));
      expect(peaks[0]!).toBeGreaterThan(peaks[1]!);
      expect(peaks[1]!).toBeGreaterThan(peaks[2]!);
      for (const voice of voices) {
        expect(voice.length / sampleRate).toBeLessThanOrEqual(0.05);
        expect(Math.abs(voice[0]!)).toBe(0);
        expect(Array.from(voice).every(Number.isFinite)).toBe(true);
        expect(Math.max(...voice.map(Math.abs))).toBeLessThanOrEqual(0.91);
      }
    }

    expect(tick[0]).not.toEqual(woodblock[0]);
    expect(tick[0]).not.toEqual(oscillator[0]);
    expect(woodblock[0]).not.toEqual(oscillator[0]);
  });

  it.each([
    ["tick", [3300, 2200, 1650]],
    ["woodblock", [1575, 1050, 790]],
  ] as const)("pitches %s accent, beat, and subdivision apart", (sound, pitches) => {
    const sampleRate = 48_000;
    const energy = (voice: Float32Array, frequency: number) => {
      let re = 0;
      let im = 0;
      voice.forEach((sample, index) => {
        re += sample * Math.cos((2 * Math.PI * frequency * index) / sampleRate);
        im += sample * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      });
      return Math.hypot(re, im);
    };
    synthesizeClickVoices(sampleRate, sound).forEach((voice, level) => {
      const own = energy(voice, pitches[level]!);
      pitches.forEach((other, otherLevel) => {
        if (otherLevel !== level) expect(own).toBeGreaterThan(energy(voice, other) * 2);
      });
    });
  });

  it.each([44_100, 48_000])("preserves the original oscillator pitches and envelopes at %i Hz", (sampleRate) => {
    const voices = synthesizeClickVoices(sampleRate, "oscillator");
    const original = [
      { frequency: 880, duration: 0.05, gain: 0.8 },
      { frequency: 440, duration: 0.03, gain: 0.4 },
    ];
    original.forEach(({ frequency, duration, gain }, level) => {
      const voice = voices[level]!;
      expect(voice.length).toBe(Math.ceil(duration * sampleRate));
      for (let sample = 0; sample < voice.length; sample++) {
        const time = sample / sampleRate;
        const envelope = gain * Math.pow(0.001 / gain, time / duration);
        const expected = Math.sin(2 * Math.PI * frequency * time) * envelope;
        expect(voice[sample]).toBeCloseTo(expected, 6);
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import { synthesizeClickVoices } from "./index";

describe("synthesized click sounds", () => {
  it.each([44_100, 48_000])("generates distinct short, bounded voices at %i Hz", (sampleRate) => {
    const tick = synthesizeClickVoices(sampleRate, "tick");
    const woodblock = synthesizeClickVoices(sampleRate, "woodblock");
    const beep = synthesizeClickVoices(sampleRate, "beep");

    for (const voices of [tick, woodblock, beep]) {
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
    expect(tick[0]).not.toEqual(beep[0]);
    expect(woodblock[0]).not.toEqual(beep[0]);
  });
});

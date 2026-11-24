import { describe, expect, it } from "vitest";
import { BasicSoundBank } from "spessasynth_core";
import { Sf2Sampler } from "./Sf2Sampler";
import { OfflineSf2Synth } from "./offlineSynth";

describe("offline SoundFont synthesis", () => {
  it("renders a sounding note on an allocated channel beyond the first MIDI port", async () => {
    const synth = await OfflineSf2Synth.create(BasicSoundBank.getSampleSoundBankFile(), 44_100);
    try {
      const channels = synth.allocateChannels(17);
      expect(channels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]);
      const sampler = new Sf2Sampler(synth, channels[15]!, 0);
      sampler.noteOn(60, 100);
      const left = new Float32Array(4096);
      const right = new Float32Array(4096);
      for (let offset = 0; offset < left.length; offset += 128) {
        synth.process(left, right, offset, 128);
      }
      expect(Math.max(...left.map(Math.abs))).toBeGreaterThan(0.00001);
      expect(Math.max(...right.map(Math.abs))).toBeGreaterThan(0.00001);
      expect(synth.voiceCount).toBeGreaterThan(0);
      sampler.noteOff(60);
    } finally {
      synth.destroy();
    }
  });

  it("rejects scheduled MIDI rather than silently playing it at the wrong time", async () => {
    const synth = await OfflineSf2Synth.create(BasicSoundBank.getSampleSoundBankFile(), 44_100);
    try {
      const sampler = new Sf2Sampler(synth, synth.allocateChannels(1)[0]!, 0);
      expect(() => sampler.noteOn(60, 100, 1)).toThrow("does not support scheduled MIDI");
      expect(() => sampler.setProgram(1, 1)).toThrow("does not support scheduled MIDI");
    } finally {
      synth.destroy();
    }
  });
});

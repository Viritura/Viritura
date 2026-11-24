import { describe, expect, it, vi } from "vitest";
import { BasicPreset, BasicSoundBank, SoundBankLoader } from "spessasynth_core";
import type { Score } from "@viritura/core";
import { dispatchSamplerEvent, OfflineSf2Synth, samplerRoutingKey } from "@viritura/audio";
import { generateTimeline } from "@viritura/midi";
import { resolveScorePlaybackParts } from "../soundProfileRuntime";
import { createOfflineSamplers } from "./offlineSamplers";
import { planStage } from "./stagePlan";

describe("offline sampler routing", () => {
  it("keeps a sustained note on its original instrument when a later instrument is selected", async () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          _x: {
            viritura: {
              initialInstrument: "first",
              instruments: {
                first: { instrumentId: "keyboard.piano", midiProgram: 0 },
                second: { instrumentId: "keyboard.piano", midiProgram: 0 },
              },
            },
          },
          measures: [
            {
              instrumentChanges: [{ instrument: "second", position: { fraction: [1, 4] } }],
              sequences: [
                {
                  content: [
                    { type: "event", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                    { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
                    { type: "event", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const timeline = generateTimeline(score);
    const synth = await OfflineSf2Synth.create(BasicSoundBank.getSampleSoundBankFile(), 44_100);
    try {
      const parts = resolveScorePlaybackParts(score);
      const samplers = createOfflineSamplers(
        score,
        parts,
        timeline.events,
        [synth],
        planStage(parts, undefined, undefined).parts,
      );
      const on = vi.spyOn(synth.synth, "noteOn");
      const off = vi.spyOn(synth.synth, "noteOff");
      for (const event of timeline.events) {
        const sampler = samplers.get(samplerRoutingKey(event));
        expect(sampler).toBeDefined();
        dispatchSamplerEvent(sampler!, event);
      }

      expect(on.mock.calls.map(([channel, note]) => [channel, note])).toEqual([
        [0, 60],
        [1, 64],
      ]);
      expect(off.mock.calls.map(([channel, note]) => [channel, note])).toEqual([
        [0, 60],
        [1, 64],
      ]);
    } finally {
      synth.destroy();
    }
  });

  it("routes an alternate percussion kit and its note release to a separate drum channel", async () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }],
        sounds: { snare: { midiNumber: 38 }, gong: { midiNumber: 45 } },
      },
      parts: [
        {
          name: "Drum Kit",
          kit: {
            snare: { sound: "snare", staffPosition: 1 },
            gong: { sound: "gong", staffPosition: -3, drumKit: 49 },
          },
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", duration: { base: "quarter" }, kitNotes: [{ kitComponent: "snare" }] },
                    { type: "event", duration: { base: "quarter" }, kitNotes: [{ kitComponent: "gong" }] },
                    { type: "event", duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const bank = SoundBankLoader.fromArrayBuffer(BasicSoundBank.getSampleSoundBankFile());
    for (const program of [0, 49]) {
      const preset = new BasicPreset(bank);
      preset.name = `Kit ${program}`;
      preset.isGMGSDrum = true;
      preset.program = program;
      preset.createZone(bank.instruments[0]!);
      bank.addPresets(preset);
    }
    bank.flush();
    const timeline = generateTimeline(score);
    const synth = await OfflineSf2Synth.create(bank.writeSF2(), 44_100);
    try {
      const programs = vi.spyOn(synth.synth, "programChange");
      const parts = resolveScorePlaybackParts(score);
      const samplers = createOfflineSamplers(
        score,
        parts,
        timeline.events,
        [synth],
        planStage(parts, undefined, undefined).parts,
      );
      const on = vi.spyOn(synth.synth, "noteOn");
      const off = vi.spyOn(synth.synth, "noteOff");
      for (const event of timeline.events) {
        const sampler = samplers.get(samplerRoutingKey(event));
        expect(sampler).toBeDefined();
        dispatchSamplerEvent(sampler!, event);
      }

      expect(programs).toHaveBeenCalledWith(0, 0);
      expect(programs).toHaveBeenCalledWith(1, 49);
      expect(on.mock.calls.map(([channel, note]) => [channel, note])).toEqual([
        [0, 38],
        [1, 45],
      ]);
      expect(off.mock.calls.map(([channel, note]) => [channel, note])).toEqual([
        [0, 38],
        [1, 45],
      ]);
    } finally {
      synth.destroy();
    }
  });
});

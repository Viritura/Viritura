import { describe, expect, it, vi } from "vitest";
import { Sf2Sampler } from "./Sf2Sampler";
import { createSamplerWorkletHarness } from "./sf2Scheduling/workletHarness.spec";

function createMockSf2Synth(currentTime = 10) {
  const synth = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    programChange: vi.fn(),
    stopAll: vi.fn(),
    controllerChange: vi.fn(),
    sendMessage: vi.fn(),
    midiChannels: Array.from({ length: 16 }, () => ({ setDrums: vi.fn(), setSystemParameter: vi.fn() })),
    connect: vi.fn(),
    isReady: Promise.resolve(),
    soundBankManager: { addSoundBank: vi.fn() },
    presetList: [],
  };
  const context = {
    state: "running",
    currentTime,
    resume: vi.fn(),
  };
  return {
    synth,
    sf2Synth: { synth, context, cancelScheduledNotes: vi.fn() } as unknown as ConstructorParameters<
      typeof Sf2Sampler
    >[0],
  };
}

describe("Sf2Sampler", () => {
  it("reversibly mutes primary and borrowed channels without delayed panic or mixer resets", () => {
    const { synth, sf2Synth } = createMockSf2Synth();
    const sampler = new Sf2Sampler(sf2Synth, 3, 0, { altKitChannels: new Map([[48, 4]]) });
    synth.programChange.mockClear();
    sampler.setPlaybackMuted(true);
    sampler.setPlaybackMuted(false);
    for (const channel of [3, 4]) {
      expect(synth.midiChannels[channel]!.setSystemParameter.mock.calls).toEqual([
        ["isMuted", true],
        ["isMuted", false],
      ]);
    }
    expect(synth.controllerChange.mock.calls).toEqual([
      [3, 120, 0],
      [4, 120, 0],
    ]);
    expect(synth.programChange).not.toHaveBeenCalled();
    expect(synth.stopAll).not.toHaveBeenCalled();
    expect(synth.midiChannels[0]!.setSystemParameter).not.toHaveBeenCalled();
  });

  it("sends 14-bit channel volume through CC7 and CC39", () => {
    const { synth, sf2Synth } = createMockSf2Synth();
    const sampler = new Sf2Sampler(sf2Synth, 3, 0);

    sampler.setVolume(0.5);

    expect(synth.controllerChange).toHaveBeenNthCalledWith(1, 3, 7, 64);
    expect(synth.controllerChange).toHaveBeenNthCalledWith(2, 3, 39, 0);
  });

  it("cancels all owned queued notes before immediate panic and unmuting", () => {
    const { synth, sf2Synth } = createMockSf2Synth(12);
    const sampler = new Sf2Sampler(sf2Synth, 3, 0, { altKitChannels: new Map([[48, 4]]) });
    const unmute = vi.spyOn(sampler, "setPlaybackMuted");

    sampler.allNotesOff();

    expect(synth.stopAll).not.toHaveBeenCalled();
    expect(sf2Synth.cancelScheduledNotes).toHaveBeenCalledExactlyOnceWith([3, 4], -Infinity);
    expect(synth.controllerChange.mock.calls).toEqual([
      [3, 120, 0],
      [3, 123, 0],
      [4, 120, 0],
      [4, 123, 0],
    ]);
    expect(unmute).toHaveBeenCalledExactlyOnceWith(false);
    expect(vi.mocked(sf2Synth.cancelScheduledNotes).mock.invocationCallOrder[0]).toBeLessThan(
      synth.controllerChange.mock.invocationCallOrder[0]!,
    );
    expect(synth.controllerChange.mock.invocationCallOrder.at(-1)).toBeLessThan(unmute.mock.invocationCallOrder[0]!);
  });

  it("reapplies mixer volume and pan to primary and borrowed drum-kit channels", () => {
    const { synth, sf2Synth } = createMockSf2Synth();
    const sampler = new Sf2Sampler(sf2Synth, 3, 0, {
      isDrum: true,
      altKitChannels: new Map([[48, 4]]),
    });
    sampler.setVolume(0);
    sampler.setPan(-1);
    sampler.allNotesOff();
    sampler.resetTechniqueState();
    for (const channel of [3, 4]) {
      expect(synth.controllerChange).toHaveBeenCalledWith(channel, 7, 0);
      expect(synth.controllerChange).toHaveBeenCalledWith(channel, 39, 0);
      expect(synth.controllerChange).toHaveBeenCalledWith(channel, 10, 0);
    }
    sampler.setVolume(0.5);
    sampler.setPan(0.5);
    for (const channel of [3, 4]) {
      expect(synth.controllerChange).toHaveBeenCalledWith(channel, 7, 64);
      expect(synth.controllerChange).toHaveBeenCalledWith(channel, 39, 0);
      expect(synth.controllerChange).toHaveBeenCalledWith(channel, 10, 95);
    }
  });

  it("sends future noteOn events directly to the synth audio queue", () => {
    const { synth, sf2Synth } = createMockSf2Synth(10);
    const sampler = new Sf2Sampler(sf2Synth, 3, 0);

    sampler.noteOn(60, 80, 10.2);

    expect(synth.noteOn).toHaveBeenCalledWith(3, 60, 80, { time: 10.2 });
  });

  it("sends future program changes directly to the synth audio queue", () => {
    const { synth, sf2Synth } = createMockSf2Synth(10);
    const sampler = new Sf2Sampler(sf2Synth, 3, 0);

    sampler.setProgram(41, 10.2);

    expect(synth.sendMessage).toHaveBeenCalledWith([0xc0 | 3, 41], 0, { time: 10.2 });
  });

  it("sends future noteOff events directly to the synth audio queue", () => {
    const { synth, sf2Synth } = createMockSf2Synth(10);
    const sampler = new Sf2Sampler(sf2Synth, 3, 0);

    sampler.noteOff(60, 10.2);

    expect(synth.noteOff).toHaveBeenCalledWith(3, 60, { time: 10.2 });
  });

  it("holds a polyphonic audition for three audio-clock seconds then releases without panic", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0);
    const notes = [48, 60, 64, 67];
    const start = h.sf2Synth.context.currentTime;
    for (const note of notes) {
      sampler.noteOn(note, 90, start);
      sampler.noteOff(note, start + 3);
    }

    for (const elapsed of [0.25, 0.4, 2.999]) {
      h.advance(start + elapsed);
      expect(h.channels[3]!.voices).toEqual(new Set(notes));
    }
    h.advance(start + 3);
    expect(h.channels[3]!.voices.size).toBe(0);
    expect(h.received.filter((event) => (event.data.messageData[0]! & 0xf0) === 0x80)).toHaveLength(4);
    expect(h.channels[3]!.controllers.has(120)).toBe(false);
    expect(h.channels[3]!.controllers.has(123)).toBe(false);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("cancels an audition deadline before a same-pitch replacement gets its own full hold", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0);
    sampler.noteOn(60, 90);
    sampler.noteOff(60, 13);
    h.advance(11);

    sampler.allNotesOff();
    sampler.noteOn(60, 90);
    sampler.noteOff(60, 14);

    h.advance(13);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    h.advance(14);
    expect(h.channels[3]!.voices.size).toBe(0);
    expect(h.attacks).toEqual([
      { channel: 3, note: 60, time: 10 },
      { channel: 3, note: 60, time: 11 },
    ]);
  });

  it("requires pedal-up for a bounded audition after inherited sustain", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0);
    sampler.sendControl(64, 127);
    sampler.allNotesOff();
    sampler.resetTechniqueState();
    sampler.noteOn(60, 90);
    sampler.noteOff(60, 13);

    h.advance(13);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    expect(h.channels[3]!.released).toEqual(new Set([60]));
    sampler.sendControl(64, 0);
    expect(h.channels[3]!.voices.size).toBe(0);
  });

  it("isolates a replacement on another channel from the old audition deadline", () => {
    const h = createSamplerWorkletHarness();
    const first = new Sf2Sampler(h.sf2Synth, 3, 0);
    const next = new Sf2Sampler(h.sf2Synth, 4, 0);
    first.noteOn(60, 80, 10);
    first.noteOff(60, 13);
    h.advance(12.9);
    first.allNotesOff();
    next.noteOn(60, 80, 12.9);
    next.noteOff(60, 15.9);
    h.advance(13);
    expect(h.channels[3]!.voices.size).toBe(0);
    expect(h.channels[4]!.voices).toEqual(new Set([60]));
    h.advance(15.9);
    expect(h.channels[4]!.voices.size).toBe(0);
  });

  it("configures an allocated non-channel-9 lane as percussion", () => {
    const { synth, sf2Synth } = createMockSf2Synth();
    const sampler = new Sf2Sampler(sf2Synth, 4, 0, { isDrum: true, drumKitProgram: 48 });

    expect(synth.midiChannels[4]!.setDrums).toHaveBeenCalledWith(true);
    expect(synth.programChange).toHaveBeenCalledWith(4, 48);

    sampler.setProgram(41);
    expect(synth.programChange).not.toHaveBeenCalledWith(4, 41);
  });

  it("cancels only owned notes at the cutoff, preserving active voices and timed setup", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0, {
      altKitChannels: new Map([
        [48, 4],
        [49, 4],
        [50, 3],
      ]),
    });
    sampler.noteOn(60, 90);
    sampler.noteOn(64, 90, undefined, 48);
    sampler.noteOn(61, 90, 10.5);
    sampler.noteOff(61, 10.75);
    sampler.noteOn(62, 90, 11);
    sampler.noteOff(60, 11);
    sampler.noteOn(63, 90, 11.5, 48);
    sampler.noteOff(63, 12, 48);
    sampler.noteOff(64, 11, 48);
    sampler.sendControl(74, 32, 11);
    sampler.setProgram(41, 11);
    h.synth.controllerChange(4, 10, 95, { time: 11 });
    h.synth.noteOn(5, 70, 90, { time: 11 });
    h.synth.noteOff(5, 70, { time: 12 });

    sampler.cancelScheduledNotes(11);

    expect(h.cancel).toHaveBeenCalledExactlyOnceWith([3, 4], 11);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    h.advance(10.5);
    expect(h.channels[3]!.voices).toEqual(new Set([60, 61]));
    h.advance(10.75);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    h.advance(11);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    expect(h.channels[3]!.controllers.get(74)).toBe(32);
    expect(h.channels[3]!.program).toBe(41);
    expect(h.channels[4]!.controllers.get(10)).toBe(95);
    expect(h.channels[5]!.voices).toEqual(new Set([70]));
    h.advance(12);
    expect(h.channels[4]!.voices).toEqual(new Set([64]));
    expect(h.channels[5]!.voices.size).toBe(0);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    expect(h.attacks.map(({ note }) => note)).toEqual([60, 64, 61, 70]);
  });

  it("stops hidden playback without ghost attacks or a delayed panic killing immediate preview", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0, { altKitChannels: new Map([[48, 4]]) });
    sampler.setVolume(0.5);
    sampler.setPan(-0.5);
    sampler.noteOn(60, 90);
    sampler.setPlaybackMuted(true);
    sampler.noteOn(61, 90, 12);
    sampler.noteOff(61, 13);
    sampler.noteOn(62, 90, 12, 48);
    sampler.noteOff(62, 13, 48);
    sampler.sendControl(74, 32, 12);
    sampler.setProgram(41, 12);
    h.synth.noteOn(5, 71, 90);
    h.synth.programChange(5, 12);
    h.synth.controllerChange(5, 7, 45);
    h.synth.noteOn(5, 70, 90, { time: 12 });
    h.synth.noteOff(5, 70, { time: 13 });
    sampler.allNotesOff();
    sampler.noteOn(72, 100);
    sampler.noteOn(73, 100, undefined, 48);

    expect(h.cancel).toHaveBeenCalledExactlyOnceWith([3, 4], -Infinity);
    for (const time of [10.05, 10.15, 10.3, 10.5, 12, 13, 20]) h.advance(time);
    expect(h.channels[3]!.voices).toEqual(new Set([72]));
    expect(h.channels[4]!.voices).toEqual(new Set([73]));
    expect(h.channels[5]!.voices).toEqual(new Set([71]));
    expect(h.channels[5]!.program).toBe(12);
    expect(h.channels[5]!.controllers.get(7)).toBe(45);
    expect(h.attacks.map(({ note }) => note)).toEqual([60, 71, 72, 73, 70]);
    for (const channel of [3, 4]) {
      expect(h.channels[channel]!.muted).toBe(false);
      expect(h.channels[channel]!.controllers.get(7)).toBe(64);
      expect(h.channels[channel]!.controllers.get(39)).toBe(0);
      expect(h.channels[channel]!.controllers.get(10)).toBe(32);
    }
    expect(h.channels[3]!.controllers.get(74)).toBe(32);
    expect(h.channels[3]!.program).toBe(41);
    expect(h.outputNode.gain.value).toBe(0.35);
  });

  it("removes overdue undrained notes as well as far-future notes on allNotesOff", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0);
    sampler.noteOn(60, 90, 10.2);
    sampler.noteOff(60, 10.4);
    sampler.noteOn(61, 90, 30);
    // The audio clock can advance before the next render quantum drains overdue notes.
    h.setClock(11);

    sampler.allNotesOff();
    h.advance(11);
    h.advance(30);

    expect(h.attacks).toEqual([]);
  });

  it("cancels and requeues a tempo edit without old attacks or releases affecting the replacement", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0);
    sampler.noteOn(60, 90, 12);
    sampler.noteOff(60, 13);

    sampler.cancelScheduledNotes(11);
    sampler.noteOn(60, 90, 11.5);
    sampler.noteOff(60, 14);

    h.advance(11.5);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    h.advance(12);
    expect(h.attacks).toEqual([{ channel: 3, note: 60, time: 11.5 }]);
    h.advance(13);
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    h.advance(14);
    expect(h.channels[3]!.voices.size).toBe(0);
    expect(h.received.filter((message) => (message.data.messageData[0]! & 0xf0) === 0x80)).toHaveLength(1);
  });

  it("retains queued primary and borrowed notes through normal mute and unmute", () => {
    const h = createSamplerWorkletHarness();
    const sampler = new Sf2Sampler(h.sf2Synth, 3, 0, { altKitChannels: new Map([[48, 4]]) });
    sampler.setVolume(0.5);
    sampler.setPan(0.5);
    sampler.noteOn(60, 90, 12);
    sampler.noteOff(60, 13);
    sampler.noteOn(61, 90, 12, 48);
    sampler.noteOff(61, 13, 48);
    sampler.setProgram(41, 12);

    sampler.setPlaybackMuted(true);
    h.advance(11);
    sampler.setPlaybackMuted(false);
    h.advance(12);

    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.channels[3]!.voices).toEqual(new Set([60]));
    expect(h.channels[4]!.voices).toEqual(new Set([61]));
    expect(h.channels[3]!.program).toBe(41);
    for (const channel of [3, 4]) {
      expect(h.channels[channel]!.controllers.get(7)).toBe(64);
      expect(h.channels[channel]!.controllers.get(10)).toBe(95);
    }
    h.advance(13);
    expect(h.channels[3]!.voices.size).toBe(0);
    expect(h.channels[4]!.voices.size).toBe(0);
    expect(h.outputNode.gain.value).toBe(0.35);
  });
});

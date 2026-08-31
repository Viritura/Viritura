import { describe, expect, it, vi } from "vitest";
import { Sf2Sampler } from "./Sf2Sampler";

function createMockSf2Synth(currentTime = 10) {
  const synth = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    programChange: vi.fn(),
    stopAll: vi.fn(),
    controllerChange: vi.fn(),
    sendMessage: vi.fn(),
    midiChannels: Array.from({ length: 16 }, () => ({ setDrums: vi.fn() })),
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
    sf2Synth: { synth, context } as unknown as ConstructorParameters<typeof Sf2Sampler>[0],
  };
}

describe("Sf2Sampler", () => {
  it("sends 14-bit channel volume through CC7 and CC39", () => {
    const { synth, sf2Synth } = createMockSf2Synth();
    const sampler = new Sf2Sampler(sf2Synth, 3, 0);

    sampler.setVolume(0.5);

    expect(synth.controllerChange).toHaveBeenNthCalledWith(1, 3, 7, 64);
    expect(synth.controllerChange).toHaveBeenNthCalledWith(2, 3, 39, 0);
  });

  it("sends repeated panic controllers on allNotesOff", () => {
    const { synth, sf2Synth } = createMockSf2Synth(12);
    const sampler = new Sf2Sampler(sf2Synth, 3, 0);

    sampler.allNotesOff();

    expect(synth.stopAll).not.toHaveBeenCalled();
    const panicCalls = synth.controllerChange.mock.calls.filter(
      ([channel, cc]) => channel === 3 && (cc === 120 || cc === 123),
    );
    expect(panicCalls).toHaveLength(10);
    expect(panicCalls[0]).toEqual([3, 120, 0, undefined]);
    expect(panicCalls[1]).toEqual([3, 123, 0, undefined]);
    expect(panicCalls.at(-2)).toEqual([3, 120, 0, { time: 12.5 }]);
    expect(panicCalls.at(-1)).toEqual([3, 123, 0, { time: 12.5 }]);
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

  it("configures an allocated non-channel-9 lane as percussion", () => {
    const { synth, sf2Synth } = createMockSf2Synth();
    const sampler = new Sf2Sampler(sf2Synth, 4, 0, { isDrum: true, drumKitProgram: 48 });

    expect(synth.midiChannels[4]!.setDrums).toHaveBeenCalledWith(true);
    expect(synth.programChange).toHaveBeenCalledWith(4, 48);

    sampler.setProgram(41);
    expect(synth.programChange).not.toHaveBeenCalledWith(4, 41);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Metronome } from "./Metronome";
import { CLICK_SOUNDS, synthesizeClickVoices } from "./clickSound";
import type { ClickLevel } from "./clickEngine";

function createMockAudioContext() {
  const masterGain = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const sources: AudioBufferSourceNode[] = [];
  return {
    sampleRate: 48_000,
    destination: {} as AudioNode,
    masterGain,
    sources,
    createGain: vi.fn(() => masterGain),
    createBuffer: vi.fn((_channels: number, length: number) => {
      const samples = new Float32Array(length);
      return { getChannelData: () => samples } as unknown as AudioBuffer;
    }),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null, connect: vi.fn(), start: vi.fn() } as unknown as AudioBufferSourceNode;
      sources.push(source);
      return source;
    }),
  };
}

describe("Metronome", () => {
  let ctx: ReturnType<typeof createMockAudioContext>;
  let metronome: Metronome;

  beforeEach(() => {
    ctx = createMockAudioContext();
    metronome = new Metronome({ audioContext: ctx as unknown as AudioContext });
  });

  afterEach(() => {
    metronome.dispose();
  });

  it("connects the master gain to the chosen destination", () => {
    expect(ctx.masterGain.connect).toHaveBeenCalledWith(ctx.destination);
    const destination = {} as AudioNode;
    const other = new Metronome({ audioContext: ctx as unknown as AudioContext, destination });
    expect(ctx.masterGain.connect).toHaveBeenLastCalledWith(destination);
    other.dispose();
  });

  it.each(CLICK_SOUNDS)("plays identical %s voices to the recording worklet at all three levels", (sound) => {
    metronome.setSound(sound);
    const voices = synthesizeClickVoices(ctx.sampleRate, sound);
    const levels: readonly ClickLevel[] = ["accent", "beat", "subdivision"];
    levels.forEach((level, index) => metronome.scheduleClick(1 + index, level));

    expect(ctx.sources).toHaveLength(3);
    ctx.sources.forEach((source, index) => {
      expect(source.buffer!.getChannelData(0)).toEqual(voices[index]);
      expect(source.start).toHaveBeenCalledWith(1 + index);
      expect(source.connect).toHaveBeenCalledWith(ctx.masterGain);
    });
  });

  it("prepares voices before scheduling and reuses them after changing sounds", () => {
    expect(ctx.createBuffer).toHaveBeenCalledTimes(3);
    metronome.scheduleClick(1, "accent");
    const tick = ctx.sources[0]!.buffer;
    expect(ctx.createBuffer).toHaveBeenCalledTimes(3);
    metronome.setSound("woodblock");
    expect(ctx.createBuffer).toHaveBeenCalledTimes(6);
    metronome.scheduleClick(2, "accent");
    expect(ctx.sources[1]!.buffer).not.toBe(tick);
    metronome.setSound("tick");
    metronome.scheduleClick(3, "accent");
    expect(ctx.sources[2]!.buffer).toBe(tick);
    expect(ctx.createBuffer).toHaveBeenCalledTimes(6);
  });

  it("does not schedule while disabled and resumes after enabling", () => {
    metronome.setEnabled(false);
    metronome.scheduleClick(1, "accent");
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    metronome.setEnabled(true);
    metronome.scheduleClick(2, "beat");
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.start).toHaveBeenCalledWith(2);
  });

  it("clamps volume to the master gain's 0-1 range", () => {
    metronome.setVolume(0.5);
    expect(metronome.getVolume()).toBe(0.5);
    expect(ctx.masterGain.gain.value).toBe(0.5);
    metronome.setVolume(-0.5);
    expect(ctx.masterGain.gain.value).toBe(0);
    metronome.setVolume(1.5);
    expect(ctx.masterGain.gain.value).toBe(1);
  });

  it("disconnects on disposal", () => {
    metronome.dispose();
    expect(ctx.masterGain.disconnect).toHaveBeenCalled();
  });
});

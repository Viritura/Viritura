import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackEngine } from "./PlaybackEngine";
import { SamplerGroup } from "./SamplerGroup";
import { LayeredSampler } from "./LayeredSampler";
import type { ISampler, MidiTimeline } from "./types";

function sampler() {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    allNotesOff: vi.fn(),
    resetTechniqueState: vi.fn(),
    resetInstrument: vi.fn(),
    sendControl: vi.fn(),
    setProgram: vi.fn(),
  } satisfies ISampler;
}

function setup() {
  let time = 0;
  const context = { state: "running", resume: vi.fn(async () => {}) };
  Object.defineProperty(context, "currentTime", { get: () => time });
  const initial = sampler();
  const primary = sampler();
  const layer = sampler();
  const changed = new LayeredSampler(primary, [{ sampler: layer, volumeRatio: 0.5 }]);
  const lane = "part:0";
  const route = (key: string) => JSON.stringify([lane, key]);
  const timeline: MidiTimeline = {
    duration: 4,
    tempoMap: [],
    measureStartTimes: [0, 2],
    events: [
      {
        type: "programChange",
        time: 0,
        midiNote: 0,
        velocity: 0,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        playbackInstrumentKey: "initial",
        instrumentChange: true,
        program: 73,
      },
      {
        type: "controlChange",
        time: 0,
        midiNote: 0,
        velocity: 0,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        cc: 11,
        value: 80,
      },
      {
        type: "noteOn",
        time: 1.9,
        midiNote: 72,
        velocity: 80,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        playbackInstrumentKey: "initial",
      },
      {
        type: "programChange",
        time: 2,
        midiNote: 0,
        velocity: 0,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        playbackInstrumentKey: "instrument:piccolo",
        instrumentChange: true,
        program: 72,
      },
      {
        type: "noteOn",
        time: 2,
        midiNote: 72,
        velocity: 80,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        playbackInstrumentKey: "instrument:piccolo",
      },
      {
        type: "noteOff",
        time: 2.1,
        midiNote: 72,
        velocity: 0,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        playbackInstrumentKey: "initial",
      },
      {
        type: "noteOff",
        time: 2.3,
        midiNote: 72,
        velocity: 0,
        channel: 0,
        partIndex: 0,
        playbackLaneId: lane,
        playbackInstrumentKey: "instrument:piccolo",
      },
    ],
  };
  const engine = new PlaybackEngine(context as unknown as AudioContext, { scheduleAheadTime: 0.5 });
  const facade = new SamplerGroup([initial, changed]);
  engine.loadTimeline(
    timeline,
    new Map<number | string, ISampler>([
      [0, facade],
      [lane, facade],
      [route("initial"), initial],
      [route("instrument:piccolo"), changed],
    ]),
  );
  return {
    engine,
    initial,
    primary,
    layer,
    setTime: (value: number) => {
      time = value;
    },
  };
}

describe("instrument-routed playback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("routes a look-ahead window across the exact boundary, including layered releases", async () => {
    const { engine, initial, primary, layer } = setup();
    engine.seek(1.8);
    await engine.play();
    expect(initial.noteOn).toHaveBeenCalledOnce();
    expect(primary.noteOn).toHaveBeenCalledOnce();
    expect(layer.noteOn).toHaveBeenCalledOnce();
    expect(primary.noteOn.mock.calls[0]![0]).toBe(72);
    expect(primary.noteOn.mock.calls[0]![2]).toBeGreaterThan(initial.noteOn.mock.calls[0]![2]!);
    expect(initial.noteOff).toHaveBeenCalledOnce();
    expect(primary.resetInstrument).toHaveBeenCalledOnce();
    expect(layer.resetInstrument).toHaveBeenCalledOnce();
    expect(primary.setProgram).not.toHaveBeenCalled();
    expect(layer.setProgram).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("seeks after a change without depending on an earlier switch callback", async () => {
    const { engine, initial, primary, layer } = setup();
    engine.seek(2);
    await engine.play();
    expect(initial.noteOn).not.toHaveBeenCalled();
    expect(primary.noteOn).toHaveBeenCalledOnce();
    expect(layer.noteOn).toHaveBeenCalledOnce();
    expect(primary.sendControl).toHaveBeenCalledWith(11, 80, undefined);
    expect(layer.sendControl).toHaveBeenCalledWith(11, 80, undefined);
    engine.seek(1.8);
    expect(initial.noteOn).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it("reports an unavailable instrument route instead of falling back to the initial sound", async () => {
    const { engine, initial } = setup();
    const timeline = engine.getTimeline()!;
    engine.loadTimeline(timeline, new Map([[0, initial]]));
    const errors: string[] = [];
    engine.on("error", ({ message }) => errors.push(message));
    engine.seek(2);
    await engine.play();
    expect(initial.noteOn).not.toHaveBeenCalled();
    expect(errors.some((message) => message.includes("instrument:piccolo"))).toBe(true);
    engine.dispose();
  });
});

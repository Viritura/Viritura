import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReverbEngine, Sf2Synth } from "@viritura/audio";
import type { Score } from "@viritura/core";
import { getPlaybackSnapshot, PlaybackProvider, SCORE_CHANGE_DEBOUNCE_MS, type VstTransport } from "@viritura/playback";
import { VIRITURA_SOUNDS_PROFILE_ID, virituraSoundsSourceId } from "@viritura/sound-profiles";

vi.mock("@viritura/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@viritura/audio")>();
  return {
    ...actual,
    ReverbEngine: vi.fn(
      class {
        constructor(private context: AudioContext) {}
        wetLevel = 0.25;
        presetId = "";
        loadPreset = vi.fn(async (preset: { id: string }) => {
          this.presetId = preset.id;
          this.setWetLevel(0.25);
        });
        setWetLevel = vi.fn((level: number) => {
          this.wetLevel = level;
        });
        createSend = () => this.context.createGain();
      },
    ),
    Metronome: vi.fn(
      class {
        static getBeatsForMeasure = actual.Metronome.getBeatsForMeasure;
        setEnabled = vi.fn();
        scheduleClick = vi.fn();
        dispose = vi.fn();
      },
    ),
  };
});

function audioParam(value = 0) {
  return {
    value,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(function (this: { value: number }, next: number) {
      this.value = next;
    }),
    setTargetAtTime: vi.fn(),
  };
}

function audioNode(context: object) {
  return {
    context,
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: audioParam(1),
    frequency: audioParam(),
    Q: audioParam(),
    threshold: audioParam(),
    ratio: audioParam(),
    knee: audioParam(),
    attack: audioParam(),
    release: audioParam(),
    delayTime: audioParam(),
    positionX: audioParam(),
    positionY: audioParam(),
    positionZ: audioParam(),
  };
}

class AudioDevice {
  currentTime = 10;
  state = "running";
  destination = {};
  listener = {};
  createGain = () => audioNode(this);
  createBiquadFilter = vi.fn(() => audioNode(this));
  createDynamicsCompressor = vi.fn(() => audioNode(this));
  createDelay = () => audioNode(this);
  createPanner = () => audioNode(this);
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

// Only replace the worklet/device boundary. Production Sf2Sampler, layered/lane
// routing, createPartSampler, partLevels, PlaybackEngine and actions stay real.
function recordingSynth(context: AudioContext) {
  return {
    context,
    outputNode: context.createGain(),
    warmUp: vi.fn<Sf2Synth["warmUp"]>().mockResolvedValue(undefined),
    destroy: vi.fn(),
    synth: {
      controllerChange: vi.fn<Sf2Synth["synth"]["controllerChange"]>(),
      programChange: vi.fn<Sf2Synth["synth"]["programChange"]>(),
      noteOn: vi.fn<Sf2Synth["synth"]["noteOn"]>(),
      noteOff: vi.fn<Sf2Synth["synth"]["noteOff"]>(),
      sendMessage: vi.fn(),
      stopAll: vi.fn(),
      midiChannels: Array.from({ length: 16 }, () => ({ setDrums: vi.fn() })),
      connect: vi.fn<(node: AudioNode) => AudioNode>((node) => node),
      isReady: Promise.resolve(),
      soundBankManager: { addSoundBank: vi.fn().mockResolvedValue(undefined) },
      presetList: [],
    },
  } satisfies Sf2Synth;
}

function makeScore(name = "Piano", partCount = 3): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] }] },
    parts: Array.from({ length: partCount }, (_, index) => ({
      id: `part-${index}`,
      name,
      measures: [
        {
          sequences: [
            {
              voice: "1",
              content: [
                {
                  type: "event",
                  duration: { base: "whole" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    })),
  };
}

function actions() {
  return getPlaybackSnapshot().actions;
}

async function flush(milliseconds = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function mount(score = makeScore(), host?: VstTransport) {
  const view = render(
    <PlaybackProvider score={score} vstTransport={host} audioRenderMode={host ? "native" : "web"}>
      {null}
    </PlaybackProvider>,
  );
  act(() => {
    actions().stop();
    if (getPlaybackSnapshot().state.countInEnabled) actions().toggleCountIn();
  });
  await flush(SCORE_CHANGE_DEBOUNCE_MS);
  expect(getPlaybackSnapshot().state.duration).toBe(2);
  return view;
}

async function play() {
  await act(async () => {
    await actions().play();
  });
  expect(getPlaybackSnapshot().state.status).toBe("playing");
}

function setWebMix() {
  act(() => {
    actions().applySpatialListener(0, 0);
    for (let part = 0; part < 3; part++) actions().applySpatialPosition(part, 0, 0);
    // Equal absolute pans keep the two audible channels' compensation equal;
    // a quarter-amplitude fader therefore encodes as half-scale 14-bit CC7.
    actions().applyMix(0, 0.25, -0.5, false, false);
    actions().applyMix(1, 1, 0.5, false, false);
    actions().applyMix(2, 0.8, 0, true, false);
  });
}

function expectChannel(synth: ReturnType<typeof recordingSynth>, channel: number, volume14: number, pan: number) {
  const controls = synth.synth.controllerChange.mock.calls;
  const latest = (cc: number) => controls.filter(([ch, controller]) => ch === channel && controller === cc).at(-1)?.[2];
  expect(latest(7)).toBe(volume14 >> 7);
  expect(latest(39)).toBe(volume14 & 0x7f);
  expect(latest(10)).toBe(pan);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nativeTransport() {
  return {
    prepare: vi.fn<VstTransport["prepare"]>().mockImplementation(async (_score, plan) => {
      return new Set(plan.sf2Parts.map((part) => part.partIndex));
    }),
    start: vi.fn<VstTransport["start"]>().mockResolvedValue(undefined),
    stop: vi.fn<VstTransport["stop"]>().mockResolvedValue(undefined),
    seek: vi.fn<VstTransport["seek"]>().mockResolvedValue(undefined),
    setPartGain: vi.fn<VstTransport["setPartGain"]>().mockResolvedValue(undefined),
    setPartPan: vi.fn<NonNullable<VstTransport["setPartPan"]>>().mockResolvedValue(undefined),
    setMutedParts: vi.fn<VstTransport["setMutedParts"]>().mockResolvedValue(undefined),
    previewNote: vi.fn<VstTransport["previewNote"]>().mockResolvedValue(true),
    release: vi.fn<VstTransport["release"]>().mockResolvedValue(undefined),
  } satisfies VstTransport;
}

const synths: ReturnType<typeof recordingSynth>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  synths.length = 0;
  vi.stubGlobal("AudioContext", AudioDevice);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]))),
  );
  vi.spyOn(Sf2Synth, "create").mockImplementation(async (context) => {
    const synth = recordingSynth(context);
    synths.push(synth);
    return synth;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => actions().stop());
  cleanup();
  try {
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("PlaybackProvider web mixer lifecycle", () => {
  it("applies pre-initialization master FX and retains them across sampler reloads", async () => {
    await mount();
    await act(async () => {
      actions().setAirEQGain(5);
      actions().setLimiterThreshold(-16);
      actions().setLimiterRatio(4);
      await actions().setReverbPreset("scala-milan");
      actions().setReverbWet(0.6);
    });
    for (let generation = 0; generation < 2; generation++) {
      await play();
      const ctx = synths[generation]!.context as unknown as AudioDevice;
      expect(ctx.createBiquadFilter.mock.results[0]!.value.gain.value).toBe(5);
      const limiter = ctx.createDynamicsCompressor.mock.results[0]!.value;
      expect(limiter.threshold.value).toBe(-16);
      expect(limiter.ratio.value).toBe(4);
      const reverb = vi.mocked(ReverbEngine).mock.results.at(-1)!.value as ReverbEngine;
      expect(reverb.presetId).toBe("scala-milan");
      expect(reverb.wetLevel).toBe(0.6);
      act(() => actions().stop());
    }
  });

  it("restores fader, pan and effective mute/solo on newly constructed channels after stop/play", async () => {
    await mount();
    setWebMix();
    await play();
    expect(synths).toHaveLength(1);
    expectChannel(synths[0]!, 0, 8192, 32);
    expectChannel(synths[0]!, 1, 16383, 95);
    expectChannel(synths[0]!, 2, 0, 64);

    act(() => actions().stop());
    expect(synths[0]!.destroy).toHaveBeenCalledOnce();
    await play();
    expect(synths).toHaveLength(2);
    expectChannel(synths[1]!, 0, 8192, 32);
    expectChannel(synths[1]!, 1, 16383, 95);
    expectChannel(synths[1]!, 2, 0, 64);

    act(() => {
      actions().stop();
      // The mixer resolves solo to effective mute before calling applyMix.
      actions().applyMix(0, 0.25, -0.5, true, false);
    });
    await play();
    expect(synths).toHaveLength(3);
    expectChannel(synths[2]!, 0, 0, 32);
    expectChannel(synths[2]!, 1, 16383, 95);
    expectChannel(synths[2]!, 2, 0, 64);
  });

  it.each(["profile", "lane"] as const)("retains mixer intent through a %s reload", async (reload) => {
    const score = makeScore();
    const view = await mount(score);
    setWebMix();
    await play();
    act(() => actions().pause());
    const changed = structuredClone(score);
    if (reload === "profile") {
      changed.soundProfile = {
        profileId: VIRITURA_SOUNDS_PROFILE_ID,
        profileVersion: 1,
        parts: { "part-0": { sourceId: virituraSoundsSourceId("harpsichord") } },
      };
    } else {
      const measure = changed.parts[0]!.measures[0]!;
      const sequences = measure.sequences;
      sequences.push({ ...structuredClone(sequences[0]!), voice: "2" });
      // Voice-scoped dynamics require independent playback controller lanes.
      measure.dynamics = [
        {
          id: "second-voice-p",
          type: "immediate",
          value: "p",
          voice: "2",
          position: { fraction: [0, 1] },
        },
      ];
    }
    view.rerender(<PlaybackProvider score={changed}>{null}</PlaybackProvider>);
    await flush(SCORE_CHANGE_DEBOUNCE_MS);
    expect(synths[0]!.destroy).toHaveBeenCalledOnce();
    await play();
    expect(synths).toHaveLength(2);
    const rebuilt = synths[1]!;
    expectChannel(rebuilt, 0, 8192, 32);
    const extraLane = reload === "lane" ? 1 : 0;
    if (extraLane) expectChannel(rebuilt, 1, 8192, 32);
    expectChannel(rebuilt, 1 + extraLane, 16383, 95);
    expectChannel(rebuilt, 2 + extraLane, 0, 64);
    if (reload === "profile") expect(rebuilt.synth.programChange).toHaveBeenCalledWith(0, 6);
  });

  it("preview initialization and subsequent play cannot overwrite the saved gain or mute", async () => {
    await mount();
    setWebMix();
    await act(async () => {
      await actions().previewNote(65, 0);
    });
    expect(synths).toHaveLength(1);
    expect(synths[0]!.synth.noteOn).toHaveBeenCalledWith(0, 65, 80, { time: 10 });
    expectChannel(synths[0]!, 0, 8192, 32);
    expectChannel(synths[0]!, 2, 0, 64);
    await play();
    expect(synths).toHaveLength(1);
    expectChannel(synths[0]!, 0, 8192, 32);
    act(() => actions().stop());
    await act(async () => {
      await actions().previewNote(67, 2);
    });
    expect(synths).toHaveLength(2);
    expectChannel(synths[1]!, 0, 8192, 32);
    expectChannel(synths[1]!, 2, 0, 64);
  });

  it("retains disabled ensemble layers and their pan overrides across recreation", async () => {
    await mount(makeScore("Violin", 1));
    act(() => {
      actions().setEnsembleLayer(0, false);
      actions().applyLayerPan(0, 0, -0.75);
      actions().applyLayerPan(0, 1, 0.75);
    });
    for (let generation = 0; generation < 2; generation++) {
      await play();
      expect(synths).toHaveLength(generation + 1);
      const synth = synths[generation]!;
      expect(synth.synth.programChange).toHaveBeenCalledWith(1, 48);
      expect(synth.synth.programChange).toHaveBeenCalledWith(2, 49);
      synth.synth.noteOn.mockClear();
      await act(async () => {
        await actions().previewNote(67, 0);
      });
      expect(synth.synth.noteOn.mock.calls.map(([channel]) => channel)).toEqual([0]);
      expectChannel(synth, 1, Math.round(16383 / Math.SQRT2), 16);
      expectChannel(synth, 2, Math.round(16383 / Math.SQRT2), 111);
      act(() => actions().stop());
    }
  });
});

describe("PlaybackProvider native mixer lifecycle", () => {
  it("preserves last live controls on shared native strips instead of replaying in part order", async () => {
    const host = nativeTransport();
    let gain = 1;
    let pan = 0;
    host.setPartGain.mockImplementation(async (_part, value) => {
      gain = value;
    });
    host.setPartPan.mockImplementation(async (_part, value) => {
      pan = value;
    });
    await mount(makeScore(), host);
    await play();
    act(() => {
      actions().applyMix(0, 0.3, -0.5, false, false);
      actions().applyMix(1, 0.8, 0.75, false, false);
      actions().applyMix(0, 0.6, -0.25, false, false);
    });
    expect([gain, pan]).toEqual([0.6, -0.25]);
    act(() => actions().stop());
    await play();
    expect([gain, pan]).toEqual([0.6, -0.25]);
  });

  it.each(["setPartGain", "setPartPan", "setMutedParts"] as const)(
    "awaits %s before prepare/start and reapplies edits made during prepare",
    async (write) => {
      const host = nativeTransport();
      await mount(makeScore(), host);
      act(() => {
        actions().applyMix(0, 0.3, -0.5, true, false);
        actions().setVstMutedParts(new Set([0]));
      });
      const seed = deferred<void>();
      const prepared = deferred<ReadonlySet<number>>();
      const resync = deferred<void>();
      host[write].mockReturnValueOnce(seed.promise);
      host.prepare.mockReturnValueOnce(prepared.promise);
      let pending!: Promise<void>;
      act(() => {
        pending = actions().play();
      });
      await flush();
      expect(host.prepare).not.toHaveBeenCalled();
      expect(host.start).not.toHaveBeenCalled();
      seed.resolve();
      await flush();
      expect(host.prepare).toHaveBeenCalledOnce();
      expect(host.setPartGain).toHaveBeenCalledWith(0, 0.3);
      expect(host.setPartPan).toHaveBeenCalledWith(0, -0.5);
      expect(host.setMutedParts).toHaveBeenLastCalledWith(new Set([0]));
      // Untouched strips must also be seeded, not left to stale native defaults.
      expect(host.setPartGain).toHaveBeenCalledWith(1, 1);
      expect(host.setPartPan).toHaveBeenCalledWith(1, 0);
      act(() => {
        actions().applyMix(0, 0.6, 0.75, false, false);
        actions().setVstMutedParts(new Set([2]));
      });
      host[write].mockReturnValueOnce(resync.promise);
      prepared.resolve(new Set([0, 1, 2]));
      await flush();
      expect(host.start).not.toHaveBeenCalled();
      expect(host.setPartGain.mock.calls.filter(([part]) => part === 0).at(-1)).toEqual([0, 0.6]);
      expect(host.setPartPan.mock.calls.filter(([part]) => part === 0).at(-1)).toEqual([0, 0.75]);
      expect(host.setMutedParts).toHaveBeenLastCalledWith(new Set([2]));
      resync.resolve();
      await act(async () => {
        await pending;
      });
      expect(host.start).toHaveBeenCalledOnce();
      expect(getPlaybackSnapshot().state.status).toBe("playing");
      act(() => actions().stop());
      host.setPartGain.mockClear();
      host.setPartPan.mockClear();
      host.setMutedParts.mockClear();
      await play();
      expect(host.start).toHaveBeenCalledTimes(2);
      expect(host.setPartGain).toHaveBeenCalledWith(0, 0.6);
      expect(host.setPartPan).toHaveBeenCalledWith(0, 0.75);
      expect(host.setMutedParts).toHaveBeenLastCalledWith(new Set([2]));
    },
  );
});

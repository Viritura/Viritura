import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGINE_OPTIONS, PlaybackEngine } from "@viritura/audio";
import type { Score } from "@viritura/core";
import { getPlaybackSnapshot, PlaybackProvider, SCORE_CHANGE_DEBOUNCE_MS, type VstTransport } from "@viritura/playback";
import { SelectionPlaybackBridge } from "../components/playbackSelection";
import { eventId, noteheadId } from "../score/ElementPath";
import { resetSelectionStore, useSelectionActions, useSelectionStore } from "../store/selectionStore";

vi.mock("../store/DocumentContext", () => {
  const store = { getState: () => ({ score: makeScore() }), subscribe: () => () => {} };
  return { useDocumentStoreApi: () => store };
});

vi.mock("@viritura/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@viritura/audio")>();
  return {
    ...actual,
    ReverbEngine: vi.fn(
      class {
        loadPreset = vi.fn().mockResolvedValue(undefined);
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

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn() },
}));

// Keep the real timeline generator, engine, scheduler, and sampler-build path.
// A piano part plus an unavailable SF2 avoids worklets and soundfonts,
// while still giving the native host a real part assignment to claim.
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] }, {}, {}, {}],
    },
    parts: [
      {
        id: "piano",
        name: "Piano",
        measures: Array.from({ length: 4 }, () => ({
          sequences: [
            {
              content: Array.from({ length: 4 }, (_, index) => ({
                type: "event" as const,
                id: `event-${index}`,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "C" as const, octave: 4 } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}

function audioNode(context: object) {
  return {
    context,
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 1 },
    frequency: { value: 0 },
    Q: { value: 0 },
    threshold: { value: 0 },
    ratio: { value: 0 },
    knee: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
  };
}

class AudioDevice {
  currentTime = 10;
  state = "running";
  destination = {};
  listener = { setPosition: vi.fn(), setOrientation: vi.fn() };
  createGain = () => audioNode(this);
  createBiquadFilter = () => audioNode(this);
  createDynamicsCompressor = () => audioNode(this);
  createPanner = () => audioNode(this);
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn(async () => {
    this.state = "closed";
  });
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
    previewNote: vi.fn<VstTransport["previewNote"]>().mockResolvedValue(false),
    setMutedParts: vi.fn<VstTransport["setMutedParts"]>().mockResolvedValue(undefined),
    release: vi.fn<VstTransport["release"]>().mockResolvedValue(undefined),
  } satisfies VstTransport;
}

function observeEngine() {
  const load = vi.spyOn(PlaybackEngine.prototype, "loadTimeline");
  const play = vi.spyOn(PlaybackEngine.prototype, "play");
  return {
    load,
    play,
    get instance() {
      const instance = load.mock.contexts.at(-1);
      if (!(instance instanceof PlaybackEngine)) throw new Error("No real playback engine loaded a timeline");
      return instance;
    },
  };
}

function actions() {
  return getPlaybackSnapshot().actions;
}

describe.each(["web", "native"] as const)("PlaybackProvider transport start (%s)", (audioRenderMode) => {
  let device: AudioDevice;
  let engine: ReturnType<typeof observeEngine>;
  let host: ReturnType<typeof nativeTransport>;
  let createDevice: ReturnType<typeof vi.fn>;
  let selection: ReturnType<typeof useSelectionActions>;
  let provider: ReturnType<typeof render>;
  let score: Score;

  beforeEach(async () => {
    resetSelectionStore();
    selection = renderHook(() => useSelectionActions()).result.current;
    vi.useFakeTimers();
    device = new AudioDevice();
    createDevice = vi.fn(function () {
      return device;
    });
    vi.stubGlobal("AudioContext", createDevice);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    engine = observeEngine();
    host = nativeTransport();
    score = makeScore();
    provider = render(
      <PlaybackProvider
        score={score}
        audioRenderMode={audioRenderMode}
        vstTransport={audioRenderMode === "native" ? host : undefined}
      >
        <SelectionPlaybackBridge />
      </PlaybackProvider>,
    );
    // Reset the public, module-level store without importing its internals.
    act(() => {
      actions().stop();
      if (getPlaybackSnapshot().state.countInEnabled) actions().toggleCountIn();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCORE_CHANGE_DEBOUNCE_MS);
    });
    expect(getPlaybackSnapshot().state.duration).toBe(8);
    expect(actions().measureBeatToSeconds(1, 0)).toBe(2);
    expect(createDevice).not.toHaveBeenCalled();
  });

  afterEach(() => {
    act(() => {
      actions().stop();
      if (getPlaybackSnapshot().state.countInEnabled) actions().toggleCountIn();
    });
    cleanup();
    try {
      expect(console.error).not.toHaveBeenCalled();
      for (const call of vi.mocked(console.warn).mock.calls) {
        expect(call).toEqual(["SF2 SoundFont not available — playback will be silent"]);
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  async function play(fromSeconds?: number) {
    await act(async () => {
      await actions().play(fromSeconds);
    });
  }

  async function expectStartedAt(seconds: number, nativeOrigin = seconds) {
    expect(engine.play.mock.calls.at(-1)?.[0]).toBeCloseTo(seconds, 10);
    expect(engine.instance.getState()).toBe("playing");
    // The real scheduler anchors its origin after the audio device's pre-roll.
    device.currentTime += DEFAULT_ENGINE_OPTIONS.leadInTime;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(engine.instance.getScoreTimeSeconds()).toBeCloseTo(seconds, 10);
    expect(getPlaybackSnapshot().state.status).toBe("playing");
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBeCloseTo(Math.max(0, seconds), 10);
    if (audioRenderMode === "native") {
      expect(host.prepare).toHaveBeenLastCalledWith(makeScore(), {
        vstParts: [],
        sf2Parts: [{ partIndex: 0, program: 0, isDrum: false }],
      });
      expect(host.start.mock.calls.at(-1)?.[0]).toBeCloseTo(nativeOrigin, 10);
    } else {
      expect(host.start).not.toHaveBeenCalled();
    }
  }

  it("retains a seek made before the first audio engine exists", async () => {
    act(() => actions().seek(3.25));
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(3.25);
    expect(createDevice).not.toHaveBeenCalled();
    expect(engine.load).not.toHaveBeenCalled();

    await play();

    expect(createDevice).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.instance.getTimeline()?.duration).toBe(8);
    await expectStartedAt(3.25);
  });

  it.each(["stopped", "paused", "playing"] as const)(
    "returns to the start without changing %s transport state",
    async (status) => {
      if (status !== "stopped") {
        await play();
        if (status === "paused") {
          act(() => actions().pause());
        }
      }

      const seek = status === "stopped" ? null : vi.spyOn(PlaybackEngine.prototype, "seek");
      act(() => actions().seek(0));

      expect(getPlaybackSnapshot().state.status).toBe(status);
      expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(0);
      if (status !== "stopped") {
        expect(seek).toHaveBeenLastCalledWith(0);
      }
      if (audioRenderMode === "native") {
        expect(host.seek).toHaveBeenLastCalledWith(0);
      }
    },
  );

  it("retains a seek after explicit stop across the lazy timeline reload", async () => {
    await play(1);
    act(() => {
      actions().stop();
      actions().seek(4.75);
    });
    expect(engine.instance.getScoreTimeSeconds()).toBe(4.75);
    const loadsBeforePlay = engine.load.mock.calls.length;

    await play();

    expect(engine.load).toHaveBeenCalledTimes(loadsBeforePlay + 1);
    expect(createDevice).toHaveBeenCalledTimes(1);
    await expectStartedAt(4.75);
  });

  it("preserves the engine's seek clamping when replaying a pending start", async () => {
    act(() => actions().seek(100));

    await play();

    expect(engine.play).toHaveBeenLastCalledWith(8);
    if (audioRenderMode === "native") expect(host.start).toHaveBeenLastCalledWith(8);
  });

  it("resumes the exact audio-clock time, not a stale seek or last rendered playhead", async () => {
    act(() => actions().seek(1.25));
    await play();
    await expectStartedAt(1.25);
    const lastPublishedTime = getPlaybackSnapshot().state.playheadPosition?.timeSeconds;
    // Advance only the audio clock, without a playhead timer tick.
    device.currentTime += 0.137;
    act(() => actions().pause());
    const pausedAt = 1.387;
    expect(engine.instance.getState()).toBe("paused");
    expect(engine.instance.getScoreTimeSeconds()).toBeCloseTo(pausedAt, 10);
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(lastPublishedTime);
    device.currentTime += 5;
    expect(engine.instance.getScoreTimeSeconds()).toBeCloseTo(pausedAt, 10);
    const loadsBeforeResume = engine.load.mock.calls.length;

    await play();

    // Silent parts have no samplers, so resume also exercises a lazy rebuild.
    expect(engine.load).toHaveBeenCalledTimes(loadsBeforeResume + 1);
    await expectStartedAt(pausedAt);
  });

  it("explicit stop clears a pending seek before engine creation", async () => {
    act(() => {
      actions().seek(3.25);
      actions().stop();
    });
    expect(createDevice).not.toHaveBeenCalled();
    expect(getPlaybackSnapshot().state.playheadPosition).toBeNull();

    await play();

    await expectStartedAt(0);
  });

  it("explicit stop resets both a paused engine and a subsequent pending seek", async () => {
    await play(2.5);
    await expectStartedAt(2.5);
    act(() => {
      actions().pause();
      actions().seek(4.25);
      actions().stop();
    });
    expect(engine.instance.getScoreTimeSeconds()).toBe(0);
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    expect(getPlaybackSnapshot().state.playheadPosition).toBeNull();

    await play();

    await expectStartedAt(0);
  });

  it("does not replace a stored nonzero seek with count-in on first play or after stop", async () => {
    act(() => {
      actions().toggleCountIn();
      actions().seek(3.25);
    });
    expect(getPlaybackSnapshot().state.countInEnabled).toBe(true);
    await play();
    await expectStartedAt(3.25);

    act(() => {
      actions().stop();
      actions().seek(4.75);
    });
    await play();
    await expectStartedAt(4.75);
  });

  it("still applies count-in from the top, keeping the native musical origin at zero", async () => {
    act(() => actions().toggleCountIn());

    await play();

    await expectStartedAt(-2, 0);
  });

  it.each([0, 2.75])("explicit play(%s) wins over a stored seek", async (fromSeconds) => {
    act(() => actions().seek(4.25));

    await play(fromSeconds);

    await expectStartedAt(fromSeconds);
  });

  it("stores a selected note immediately and preserves its start after deselection", async () => {
    act(() => selection.selectElement(noteheadId(eventId(0, 1, 0, "event-1"), 0)));
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(2.5);
    expect(createDevice).not.toHaveBeenCalled();
    act(() => selection.clearSelection());
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(2.5);

    await play();

    await expectStartedAt(2.5);
  });

  it("starts at the beginning of a whole selected measure after deselecting", async () => {
    act(() => selection.selectMeasure(0, 0, 2));
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(4);
    act(() => selection.clearSelection());

    await play();

    await expectStartedAt(4);
  });

  it.each([
    { kind: "note", seconds: 4.5, measureIndex: 2, beat: 1 },
    { kind: "measure", seconds: 6, measureIndex: 3, beat: 0 },
  ])("seeks a selected $kind during playback and keeps both transports running", async (target) => {
    await play(1);
    await expectStartedAt(1);
    const seek = vi.spyOn(PlaybackEngine.prototype, "seek");
    host.seek.mockClear();
    host.stop.mockClear();
    const loads = engine.load.mock.calls.length;
    const starts = engine.play.mock.calls.length;
    const nativeStarts = host.start.mock.calls.length;
    act(() => {
      if (target.kind === "note") selection.selectElement(noteheadId(eventId(0, 2, 0, "event-1"), 0));
      else selection.selectMeasure(0, 0, 3);
    });
    expect(seek).toHaveBeenCalledExactlyOnceWith(target.seconds);
    expect(engine.instance.getState()).toBe("playing");
    expect(getPlaybackSnapshot().state.status).toBe("playing");
    expect(getPlaybackSnapshot().state.playheadPosition).toMatchObject({
      timeSeconds: target.seconds,
      measureIndex: target.measureIndex,
      beat: target.beat,
    });
    if (audioRenderMode === "native") expect(host.seek).toHaveBeenCalledExactlyOnceWith(target.seconds);
    else expect(host.seek).not.toHaveBeenCalled();

    act(() => selection.clearSelection());
    expect(seek).toHaveBeenCalledTimes(1);
    expect(host.seek).toHaveBeenCalledTimes(audioRenderMode === "native" ? 1 : 0);
    device.currentTime += DEFAULT_ENGINE_OPTIONS.leadInTime + 0.25;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(engine.instance.getScoreTimeSeconds()).toBeCloseTo(target.seconds + 0.25, 10);
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBeCloseTo(target.seconds + 0.25, 10);
    expect(getPlaybackSnapshot().state.status).toBe("playing");
    expect(engine.load).toHaveBeenCalledTimes(loads);
    expect(engine.play).toHaveBeenCalledTimes(starts);
    expect(host.start).toHaveBeenCalledTimes(nativeStarts);
    expect(host.stop).not.toHaveBeenCalled();

    device.currentTime += 0.137;
    act(() => actions().pause());
    await play();
    await expectStartedAt(target.seconds + 0.387);
  });

  it("does not replay an unchanged active selection on store notifications, rerenders, or bridge remount", async () => {
    await play(1);
    act(() => selection.selectMeasure(0, 0, 2));
    const seek = vi.spyOn(PlaybackEngine.prototype, "seek");
    host.seek.mockClear();
    device.currentTime += DEFAULT_ENGINE_OPTIONS.leadInTime + 0.25;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    act(() => {
      useSelectionStore.setState({ selection: useSelectionStore.getState().selection });
      actions().setVolume(0.7);
    });
    const props = { score, audioRenderMode, vstTransport: audioRenderMode === "native" ? host : undefined };
    provider.rerender(
      <PlaybackProvider {...props} visiblePartIds={["piano"]}>
        <SelectionPlaybackBridge />
      </PlaybackProvider>,
    );
    provider.rerender(<PlaybackProvider {...props}>{null}</PlaybackProvider>);
    provider.rerender(
      <PlaybackProvider {...props}>
        <SelectionPlaybackBridge />
      </PlaybackProvider>,
    );
    expect(seek).not.toHaveBeenCalled();
    expect(host.seek).not.toHaveBeenCalled();
    expect(engine.instance.getScoreTimeSeconds()).toBeCloseTo(4.25, 10);
    expect(getPlaybackSnapshot().state.status).toBe("playing");
  });

  it("keeps the latest of rapid active selections without waiting for native seek replies", async () => {
    await play(1);
    const seek = vi.spyOn(PlaybackEngine.prototype, "seek");
    const replies: (() => void)[] = [];
    host.seek.mockClear().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          replies.push(resolve);
        }),
    );
    act(() => {
      selection.selectElement(noteheadId(eventId(0, 2, 0, "event-1"), 0));
      selection.selectMeasure(0, 0, 1);
      selection.clearSelection();
    });
    expect(seek.mock.calls).toEqual([[4.5], [2]]);
    expect(host.seek.mock.calls).toEqual(audioRenderMode === "native" ? [[4.5], [2]] : []);
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(2);
    await act(async () => {
      for (const reply of replies.reverse()) reply();
    });
    device.currentTime += DEFAULT_ENGINE_OPTIONS.leadInTime + 0.25;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(engine.instance.getScoreTimeSeconds()).toBeCloseTo(2.25, 10);
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBeCloseTo(2.25, 10);
    expect(getPlaybackSnapshot().state.status).toBe("playing");
  });

  it.each(["pause", "stop"] as const)("a late native seek reply cannot undo %s", async (command) => {
    await play(1);
    let reply = () => {};
    host.seek.mockReturnValue(
      new Promise<void>((resolve) => {
        reply = resolve;
      }),
    );
    act(() => selection.selectMeasure(0, 0, 2));
    device.currentTime += DEFAULT_ENGINE_OPTIONS.leadInTime + 0.25;
    act(() => actions()[command]());
    const position = getPlaybackSnapshot().state.playheadPosition;
    const starts = engine.play.mock.calls.length;
    const nativeStarts = host.start.mock.calls.length;
    await act(async () => reply());
    expect(engine.instance.getState()).toBe(command === "pause" ? "paused" : "stopped");
    expect(getPlaybackSnapshot().state.status).toBe(command === "pause" ? "paused" : "stopped");
    expect(getPlaybackSnapshot().state.playheadPosition).toBe(position);
    expect(engine.play).toHaveBeenCalledTimes(starts);
    expect(host.start).toHaveBeenCalledTimes(nativeStarts);

    await play();
    await expectStartedAt(command === "pause" ? 4.25 : 0);
  });

  it.each(["note", "measure"])(
    "a new %s selection while paused replaces the resume position and survives deselection",
    async (kind) => {
      await play(1);
      act(() => actions().pause());
      const seconds = kind === "note" ? 4.5 : 4;
      act(() => {
        if (kind === "note") selection.selectElement(noteheadId(eventId(0, 2, 0, "event-1"), 0));
        else selection.selectMeasure(0, 0, 2);
      });
      expect(engine.instance.getState()).toBe("paused");
      expect(getPlaybackSnapshot().state.status).toBe("paused");
      expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(seconds);
      act(() => selection.clearSelection());

      await play();

      await expectStartedAt(seconds);
    },
  );

  it("explicit stop wins over an unchanged selection and bridge remount does not replay it", async () => {
    act(() => selection.selectMeasure(0, 0, 2));
    act(() => actions().stop());
    // Like a score/view remount, installing a subscription is not a selection.
    const remount = render(<SelectionPlaybackBridge />);
    remount.unmount();
    expect(getPlaybackSnapshot().state.playheadPosition).toBeNull();

    await play();

    await expectStartedAt(0);
  });

  it("honors a newer selection accepted while audio initialization is awaiting permission", async () => {
    device.state = "suspended";
    let resumeAudio = () => {};
    const resumed = new Promise<void>((resolve) => {
      resumeAudio = resolve;
    });
    device.resume.mockReturnValue(resumed);
    let started: Promise<void> | undefined;
    act(() => {
      selection.selectMeasure(0, 0, 1);
      started = actions().play();
      selection.selectMeasure(0, 0, 2);
      selection.clearSelection();
    });
    expect(getPlaybackSnapshot().state.playheadPosition?.timeSeconds).toBe(4);

    await act(async () => {
      device.state = "running";
      resumeAudio();
      await started;
    });

    await expectStartedAt(4);
  });

  it("explicit stop cancels an in-flight start rather than replaying its captured position", async () => {
    device.state = "suspended";
    let resumeAudio = () => {};
    device.resume.mockReturnValue(
      new Promise<void>((resolve) => {
        resumeAudio = resolve;
      }),
    );
    let started: Promise<void> | undefined;
    act(() => {
      selection.selectMeasure(0, 0, 2);
      started = actions().play();
      actions().stop();
    });
    await act(async () => {
      device.state = "running";
      resumeAudio();
      await started;
    });
    expect(engine.play).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    expect(getPlaybackSnapshot().state.status).toBe("stopped");
    expect(getPlaybackSnapshot().state.playheadPosition).toBeNull();

    await play();

    await expectStartedAt(0);
  });
});

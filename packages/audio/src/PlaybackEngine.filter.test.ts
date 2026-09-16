import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackEngine } from "./PlaybackEngine";
import { SamplerGroup } from "./SamplerGroup";
import type { ISampler, MidiEvent, MidiTimeline } from "./types";

function createSampler(getAudioTime?: () => number, retainsQueuedNotes = false) {
  let program = 40;
  let muted = false;
  const controls = new Map<number, number>();
  const activeNotes = new Set<number>();
  const sustainedNotes = new Set<number>();
  let queue: { time: number; run: () => void; note: boolean }[] = [];
  function flush() {
    queue.sort((a, b) => a.time - b.time);
    while (queue.length && queue[0]!.time <= (getAudioTime?.() ?? Infinity)) queue.shift()!.run();
  }
  function schedule(time: number | undefined, run: () => void, note: boolean) {
    queue.push({ time: time ?? getAudioTime?.() ?? 0, run, note });
    flush();
  }
  function clearNotes() {
    activeNotes.clear();
    sustainedNotes.clear();
  }
  const sampler = {
    activeNotes,
    flush,
    setPlaybackMuted: retainsQueuedNotes
      ? vi.fn((value: boolean) => {
          flush();
          muted = value;
          if (muted) clearNotes();
        })
      : undefined,
    noteOn: vi.fn((midiNote: number, velocity: number, time?: number) => {
      schedule(
        time,
        () => {
          if (!muted) activeNotes.add(midiNote);
        },
        true,
      );
      return { program, expression: controls.get(11), velocity, time };
    }),
    noteOff: vi.fn((midiNote: number, time?: number) => {
      schedule(
        time,
        () => {
          if ((controls.get(64) ?? 0) >= 64) sustainedNotes.add(midiNote);
          else activeNotes.delete(midiNote);
        },
        true,
      );
    }),
    allNotesOff: vi.fn(() => {
      flush();
      clearNotes();
      queue = queue.filter((event) => !event.note);
    }),
    setProgram: vi.fn((value: number, time?: number) => {
      schedule(
        time,
        () => {
          program = value;
        },
        false,
      );
    }),
    sendControl: vi.fn((cc: number, value: number, time?: number) => {
      schedule(
        time,
        () => {
          controls.set(cc, value);
          if (cc === 64 && value < 64) {
            for (const note of sustainedNotes) activeNotes.delete(note);
            sustainedNotes.clear();
          }
        },
        false,
      );
    }),
    resetTechniqueState: vi.fn(() => {
      program = 40;
      controls.clear();
    }),
    setVolume: vi.fn<(volume: number) => void>(),
    setPan: vi.fn<(pan: number) => void>(),
  };
  return sampler;
}

function createFixture(
  routing: "parts" | "lanes" | "facades",
  getAudioTime?: () => number,
  retainsQueuedNotes = false,
) {
  const samplers = new Map<number | string, ISampler>();
  const lanes = [0, 1].flatMap((partIndex) =>
    (routing === "parts" ? ["part"] : ["staff1:voice1", "staff1:voice2", "staff2:voice1", "staff2:voice2"]).map(
      (lane, index) => ({
        partIndex,
        playbackLaneId: routing === "parts" ? undefined : `${partIndex}:${lane}`,
        sampler: createSampler(getAudioTime, retainsQueuedNotes),
        program: 45 + index,
        expression: 70 + index,
      }),
    ),
  );
  const events = lanes.flatMap(({ partIndex, playbackLaneId, program, expression, sampler }): MidiEvent[] => {
    samplers.set(playbackLaneId ?? partIndex, sampler);
    const base = { partIndex, playbackLaneId, channel: partIndex, midiNote: 60, velocity: 80 };
    return [
      { ...base, type: "noteOn", time: 0 },
      { ...base, type: "programChange", time: 0.5, program: 42 },
      { ...base, type: "controlChange", time: 0.5, cc: 11, value: 50 },
      { ...base, type: "noteOn", time: 0.6, midiNote: 62 },
      { ...base, type: "noteOff", time: 0.8, midiNote: 62, velocity: 0 },
      { ...base, type: "programChange", time: 0.9, program },
      { ...base, type: "controlChange", time: 0.9, cc: 11, value: expression },
      { ...base, type: "noteOff", time: 1.4, velocity: 0 },
      { ...base, type: "noteOn", time: 1.5, midiNote: 64 },
      { ...base, type: "noteOff", time: 1.8, midiNote: 64, velocity: 0 },
    ];
  });
  if (routing === "facades") {
    for (const partIndex of [0, 1]) {
      samplers.set(
        partIndex,
        new SamplerGroup(lanes.filter((lane) => lane.partIndex === partIndex).map((lane) => lane.sampler)),
      );
    }
  }
  const timeline: MidiTimeline = {
    events: events.sort((a, b) => a.time - b.time),
    duration: 2,
    tempoMap: [{ measureIndex: 0, beat: 0, time: 0, bpm: 120 }],
    measureStartTimes: [0],
  };
  return { samplers, lanes, timeline };
}

describe.each(["parts", "lanes", "facades"] as const)("PlaybackEngine part filter (%s)", (routing) => {
  let engine: PlaybackEngine;
  let audioTime: number;

  function tick(time: number) {
    audioTime = time;
    vi.advanceTimersByTime(25);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    audioTime = 0;
    const audioContext = {
      state: "running",
      get currentTime() {
        return audioTime;
      },
    } as AudioContext;
    engine = new PlaybackEngine(audioContext, { leadInTime: 0, scheduleAheadTime: 0.05 });
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it.each([null, new Set([0, 1])])("preserves hidden controls on live restore to %s", (restoredFilter) => {
    const { samplers, lanes, timeline } = createFixture(routing);
    for (const { sampler } of lanes) {
      sampler.setVolume(0.35);
      sampler.setPan(-0.4);
    }
    engine.loadTimeline(timeline, samplers);
    engine.play();
    for (const { sampler } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledExactlyOnceWith(60, 80, 0, undefined);
    }

    engine.setViewPartFilter(new Set([0]));
    for (const { partIndex, sampler } of lanes) {
      expect(sampler.allNotesOff).toHaveBeenCalledTimes(partIndex === 1 ? 1 : 0);
      expect(sampler.activeNotes.has(60)).toBe(partIndex === 0);
    }

    tick(0.5);
    tick(0.6);
    tick(0.8);
    tick(0.9);
    for (const { partIndex, sampler, program, expression } of lanes) {
      expect(sampler.setProgram.mock.calls).toEqual([
        [42, 0.5],
        [program, 0.9],
      ]);
      expect(sampler.sendControl.mock.calls).toEqual([
        [11, 50, 0.5],
        [11, expression, 0.9],
      ]);
      expect(sampler.noteOn).toHaveBeenCalledTimes(partIndex === 1 ? 1 : 2);
      expect(sampler.noteOff).toHaveBeenCalledExactlyOnceWith(62, 0.8, undefined);
    }

    tick(1.2);
    engine.setViewPartFilter(restoredFilter);
    expect(engine.getState()).toBe("playing");
    expect(engine.getScoreTimeSeconds()).toBe(1.2);
    for (const { partIndex, sampler, program, expression } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledTimes(2);
      expect(sampler.activeNotes.has(60)).toBe(true);
      if (partIndex === 1) {
        expect(sampler.noteOn).toHaveBeenLastCalledWith(60, 80, 1.2, undefined);
        expect(sampler.noteOn).toHaveLastReturnedWith({ program, expression, velocity: 80, time: 1.2 });
      }
      expect(sampler.allNotesOff).toHaveBeenCalledTimes(partIndex === 1 ? 1 : 0);
      expect(sampler.resetTechniqueState).toHaveBeenCalledTimes(1);
      expect(sampler.setVolume).toHaveBeenCalledExactlyOnceWith(0.35);
      expect(sampler.setPan).toHaveBeenCalledExactlyOnceWith(-0.4);
    }

    tick(1.4);
    tick(1.5);
    for (const { sampler, program, expression } of lanes) {
      expect(sampler.noteOff).toHaveBeenLastCalledWith(60, 1.4, undefined);
      expect(sampler.noteOn).toHaveBeenLastCalledWith(64, 80, 1.5, undefined);
      expect(sampler.noteOn).toHaveLastReturnedWith({ program, expression, velocity: 80, time: 1.5 });
      expect(sampler.activeNotes).toEqual(new Set([64]));
    }
    tick(1.8);
    for (const { sampler } of lanes) {
      expect(sampler.noteOff).toHaveBeenLastCalledWith(64, 1.8, undefined);
      expect(sampler.activeNotes.size).toBe(0);
    }
  });

  it("restores every initially hidden lane and switches selections without replaying ended notes", () => {
    const { samplers, lanes, timeline } = createFixture(routing);
    engine.loadTimeline(timeline, samplers);
    engine.setViewPartFilter(new Set([0]));
    engine.play();
    tick(0.5);
    tick(0.6);
    tick(0.8);
    tick(0.9);
    tick(1.2);
    const playhead = vi.fn();
    engine.on("playhead", playhead);
    engine.setViewPartFilter(new Set([1]));
    for (const { partIndex, sampler, program, expression } of lanes) {
      if (partIndex === 0) expect(sampler.activeNotes.size).toBe(0);
      else {
        expect(sampler.noteOn).toHaveBeenCalledExactlyOnceWith(60, 80, 1.2, undefined);
        expect(sampler.noteOn).toHaveLastReturnedWith({ program, expression, velocity: 80, time: 1.2 });
      }
    }
    engine.setViewPartFilter(null);
    engine.setViewPartFilter(new Set([0, 1]));
    engine.setViewPartFilter(null);
    expect(playhead).not.toHaveBeenCalled();
    expect(engine.getScoreTimeSeconds()).toBe(1.2);
    for (const { partIndex, sampler } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledTimes(partIndex === 0 ? 3 : 1);
      expect(sampler.activeNotes).toEqual(new Set([60]));
    }
  });

  it.each(["pause", "stop"] as const)("does not sound on filter changes after %s", (action) => {
    const { samplers, lanes, timeline } = createFixture(routing);
    engine.loadTimeline(timeline, samplers);
    engine.setViewPartFilter(new Set([0]));
    engine.play();
    tick(0.2);
    engine[action]();
    const position = engine.getScoreTimeSeconds();
    for (const { sampler } of lanes) sampler.noteOn.mockClear();
    engine.setViewPartFilter(null);
    engine.setViewPartFilter(new Set([1]));
    tick(0.4);
    expect(engine.getScoreTimeSeconds()).toBe(position);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn).not.toHaveBeenCalled();
      expect(sampler.activeNotes.size).toBe(0);
    }
  });

  it("restores every held pitch with its velocity and alternate drum-kit routing", () => {
    const { samplers, lanes, timeline } = createFixture(routing);
    const extra = lanes.flatMap(({ partIndex, playbackLaneId }): MidiEvent[] => {
      const base = { partIndex, playbackLaneId, channel: partIndex, midiNote: 67, velocity: 97, drumKitProgram: 48 };
      return [
        { ...base, type: "noteOn", time: 0.1 },
        { ...base, type: "noteOff", time: 1.6 },
      ];
    });
    engine.loadTimeline(
      { ...timeline, events: [...timeline.events, ...extra].sort((a, b) => a.time - b.time) },
      samplers,
    );
    engine.setViewPartFilter(new Set());
    engine.play();
    tick(0.1);
    audioTime = 0.2;
    engine.setViewPartFilter(null);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn.mock.calls).toEqual([
        [60, 80, 0.2, undefined],
        [67, 97, 0.2, 48],
      ]);
      expect(sampler.activeNotes).toEqual(new Set([60, 67]));
    }
    tick(1.4);
    tick(1.6);
    for (const { sampler } of lanes) expect(sampler.noteOff).toHaveBeenLastCalledWith(67, 1.6, 48);
  });

  it("restores pedal-sustained notes with key-up and releases them at pedal-up", () => {
    const { samplers, lanes, timeline } = createFixture(routing);
    const events = lanes
      .flatMap(({ partIndex, playbackLaneId }): MidiEvent[] => {
        const base = { partIndex, playbackLaneId, channel: partIndex, midiNote: 60, velocity: 80 };
        return [
          { ...base, type: "noteOn", time: 0 },
          { ...base, type: "controlChange", time: 0.1, cc: 64, value: 127 },
          { ...base, type: "noteOff", time: 0.2 },
          { ...base, type: "controlChange", time: 1, cc: 64, value: 0 },
        ];
      })
      .sort((a, b) => a.time - b.time);
    engine.loadTimeline({ ...timeline, events }, samplers);
    engine.setViewPartFilter(new Set([0]));
    engine.play();
    tick(0.1);
    tick(0.2);
    audioTime = 0.4;
    engine.setViewPartFilter(null);
    for (const { partIndex, sampler } of lanes) {
      expect(sampler.activeNotes).toEqual(new Set([60]));
      if (partIndex === 1) {
        expect(sampler.noteOn).toHaveBeenCalledExactlyOnceWith(60, 80, 0.4, undefined);
        expect(sampler.noteOff).toHaveBeenLastCalledWith(60, 0.4, undefined);
      }
      expect(sampler.sendControl).toHaveBeenCalledExactlyOnceWith(64, 127, 0.1);
    }
    tick(1);
    engine.setViewPartFilter(new Set([0]));
    engine.setViewPartFilter(null);
    for (const { sampler } of lanes) {
      expect(sampler.activeNotes.size).toBe(0);
      expect(sampler.noteOn).toHaveBeenCalledTimes(1);
    }
  });

  it("honors lead-in and tempo scaling when recovering skipped future attacks", () => {
    engine.dispose();
    const context = {
      state: "running",
      get currentTime() {
        return audioTime;
      },
    } as AudioContext;
    engine = new PlaybackEngine(context, { leadInTime: 0.12, scheduleAheadTime: 0.5 });
    const { samplers, lanes, timeline } = createFixture(routing, () => audioTime);
    engine.loadTimeline(timeline, samplers);
    engine.setTempo(240);
    engine.setViewPartFilter(new Set());
    engine.play();
    audioTime = 0.02;
    engine.setViewPartFilter(null);
    expect(engine.getScoreTimeSeconds()).toBeCloseTo(-0.2);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn.mock.calls).toEqual([
        [60, 80, 0.12, undefined],
        [62, 80, 0.42, undefined],
      ]);
      expect(sampler.activeNotes.size).toBe(0);
    }
    tick(0.12);
    for (const { sampler } of lanes) {
      sampler.flush();
      expect(sampler.activeNotes).toEqual(new Set([60]));
    }
  });

  it("leaves future skipped attacks to the new scheduler window after a tempo change", () => {
    const { samplers, lanes, timeline } = createFixture(routing, () => audioTime);
    engine.loadTimeline(timeline, samplers);
    engine.setViewPartFilter(new Set());
    engine.play();
    tick(0.57);
    audioTime = 0.58;
    engine.setTempo(240);
    engine.setViewPartFilter(null);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledExactlyOnceWith(60, 80, 0.58, undefined);
    }
    tick(0.58);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledTimes(2);
      expect(sampler.noteOn).toHaveBeenLastCalledWith(62, 80, 0.59, undefined);
    }
  });

  describe.each([false, true])("queued events (retained on mute: %s)", (retainsQueuedNotes) => {
    it.each([0.58, 0.65])("recovers a skipped onset with a not-yet-scheduled release at %s", (restoreAt) => {
      const { samplers, lanes, timeline } = createFixture(routing, () => audioTime, retainsQueuedNotes);
      engine.loadTimeline(timeline, samplers);
      engine.setViewPartFilter(new Set([0]));
      engine.play();
      tick(0.57);
      audioTime = restoreAt;
      for (const { sampler } of lanes) sampler.flush();
      engine.setViewPartFilter(null);
      for (const { partIndex, sampler } of lanes) {
        if (partIndex === 1)
          expect(sampler.noteOn.mock.calls).toEqual([
            [60, 80, restoreAt, undefined],
            [62, 80, Math.max(restoreAt, 0.6), undefined],
          ]);
        expect(sampler.activeNotes.has(62)).toBe(restoreAt >= 0.6);
      }
      tick(0.7);
      for (const { sampler } of lanes) {
        sampler.flush();
        expect(sampler.activeNotes).toEqual(new Set([60, 62]));
      }
      tick(0.8);
      for (const { sampler } of lanes) {
        sampler.flush();
        expect(sampler.noteOn).toHaveBeenCalledTimes(2);
        expect(sampler.noteOff).toHaveBeenCalledExactlyOnceWith(62, 0.8, undefined);
        expect(sampler.activeNotes).toEqual(new Set([60]));
      }
    });

    it.each(
      [false, true].flatMap((initiallyHidden) => [0.01, 0.03].map((restoreAt) => ({ initiallyHidden, restoreAt }))),
    )("restores queued notes at $restoreAt (initially hidden: $initiallyHidden)", ({ initiallyHidden, restoreAt }) => {
      const { samplers, lanes, timeline } = createFixture(routing, () => audioTime, retainsQueuedNotes);
      const events = timeline.events
        .filter((event) => event.type === "noteOn" || event.type === "noteOff")
        .map((event) => ({
          ...event,
          time: event.time === 0 ? 0.02 : event.time === 1.4 ? 0.04 : event.time,
        }))
        .sort((a, b) => a.time - b.time);
      engine.loadTimeline({ ...timeline, events }, samplers);
      const click = vi.fn();
      engine.setClickTrack([{ time: 0.03, accented: true }]);
      engine.setClickCallback(click);
      if (initiallyHidden) engine.setViewPartFilter(new Set([0]));
      engine.play();
      if (!initiallyHidden) engine.setViewPartFilter(new Set([0]));
      audioTime = restoreAt;
      for (const { sampler } of lanes) sampler.flush();
      engine.setViewPartFilter(null);
      engine.setViewPartFilter(null);
      for (const { partIndex, sampler } of lanes) {
        const attacks = partIndex === 1 && !initiallyHidden && (!retainsQueuedNotes || restoreAt > 0.02) ? 2 : 1;
        expect(sampler.noteOn).toHaveBeenCalledTimes(attacks);
        expect(sampler.noteOn).toHaveBeenLastCalledWith(
          60,
          80,
          partIndex === 1 ? Math.max(0.02, restoreAt) : 0.02,
          undefined,
        );
        expect(sampler.noteOff).toHaveBeenLastCalledWith(60, 0.04, undefined);
        expect(sampler.activeNotes.has(60)).toBe(restoreAt >= 0.02);
      }
      tick(Math.max(0.02, restoreAt));
      for (const { sampler } of lanes) {
        sampler.flush();
        expect(sampler.activeNotes).toEqual(new Set([60]));
      }
      tick(0.04);
      for (const { sampler } of lanes) {
        sampler.flush();
        expect(sampler.activeNotes.size).toBe(0);
      }
      expect(click).toHaveBeenCalledExactlyOnceWith(0.03, true);
    });

    it.each(["pause", "stop"] as const)("keeps queued notes silent after %s and clearing the filter", (action) => {
      const { samplers, lanes, timeline } = createFixture(routing, () => audioTime, retainsQueuedNotes);
      engine.loadTimeline(timeline, samplers);
      engine.play();
      tick(0.57);
      engine.setViewPartFilter(new Set([0]));
      engine[action]();
      for (const { sampler } of lanes) sampler.noteOn.mockClear();
      engine.setViewPartFilter(null);
      tick(0.7);
      for (const { sampler } of lanes) {
        sampler.flush();
        expect(sampler.noteOn).not.toHaveBeenCalled();
        expect(sampler.activeNotes.size).toBe(0);
      }
    });

    it("restores held notes before already queued releases across repeated toggles", () => {
      const { samplers, lanes, timeline } = createFixture(routing, () => audioTime, retainsQueuedNotes);
      engine.loadTimeline(timeline, samplers);
      engine.play();
      tick(1.37);
      engine.setViewPartFilter(new Set([0]));
      audioTime = 1.38;
      engine.setViewPartFilter(null);
      engine.setViewPartFilter(new Set([0]));
      audioTime = 1.39;
      engine.setViewPartFilter(null);
      for (const { partIndex, sampler } of lanes) {
        sampler.flush();
        expect(sampler.activeNotes).toEqual(new Set([60]));
        if (partIndex === 1) {
          expect(sampler.noteOn.mock.calls).toEqual([
            [60, 80, 0, undefined],
            [60, 80, 1.38, undefined],
            [60, 80, 1.39, undefined],
          ]);
        } else expect(sampler.noteOn).toHaveBeenCalledTimes(1);
      }
      tick(1.4);
      for (const { sampler } of lanes) {
        sampler.flush();
        expect(sampler.activeNotes.size).toBe(0);
      }
    });
  });

  it("handles mixed queue capabilities and partial part facades without losing lanes", () => {
    const { samplers, lanes, timeline } = createFixture(routing, () => audioTime, true);
    if (routing === "facades") samplers.delete(1);
    lanes.find((lane) => lane.partIndex === 1)!.sampler.setPlaybackMuted = undefined;
    engine.loadTimeline(timeline, samplers);
    engine.play();
    tick(0.57);
    engine.setViewPartFilter(new Set([0]));
    audioTime = 0.58;
    engine.setViewPartFilter(null);
    for (const { partIndex, sampler } of lanes) {
      const attacks = sampler.noteOn.mock.calls.filter(([note]) => note === 62);
      expect(attacks).toHaveLength(partIndex === 1 && !sampler.setPlaybackMuted ? 2 : 1);
      expect(sampler.noteOn).toHaveBeenCalledWith(60, 80, partIndex === 1 ? 0.58 : 0, undefined);
    }
    tick(0.8);
    for (const { sampler } of lanes) {
      sampler.flush();
      expect(sampler.activeNotes).toEqual(new Set([60]));
    }
  });

  it("discards old queued recovery timestamps when seeking and restarting", () => {
    const { samplers, lanes, timeline } = createFixture(routing, () => audioTime, true);
    engine.loadTimeline(timeline, samplers);
    engine.setViewPartFilter(new Set());
    engine.play();
    tick(0.57);
    engine.seek(0);
    audioTime = 0.58;
    engine.setViewPartFilter(null);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledExactlyOnceWith(60, 80, 0.58, undefined);
    }
    engine.stop();
    engine.setViewPartFilter(new Set());
    engine.play();
    audioTime = 0.59;
    engine.setViewPartFilter(null);
    for (const { sampler } of lanes) {
      expect(sampler.noteOn).toHaveBeenCalledTimes(2);
      expect(sampler.noteOn).toHaveBeenLastCalledWith(60, 80, 0.59, undefined);
    }
  });
});

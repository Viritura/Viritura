import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaybackEngine } from "./PlaybackEngine";
import type {
  ISampler,
  MidiEvent,
  MidiTimeline,
  PlaybackState,
  PlayheadPosition,
  StateEventDetail,
  LoadedEventDetail,
  ErrorEventDetail,
} from "./types";

// ─── Mock AudioContext ────────────────────────

function makeAudioContext(): { ctx: AudioContext; setTime: (t: number) => void } {
  let time = 0;
  const obj = {
    state: "running" as string,
    resume: vi.fn(() => Promise.resolve()),
  };

  Object.defineProperty(obj, "currentTime", {
    get: () => time,
    configurable: true,
  });

  return {
    ctx: obj as unknown as AudioContext,
    setTime: (t: number) => {
      time = t;
    },
  };
}

// ─── Mock Sampler ─────────────────────────────

function createMockSampler(): ISampler & {
  noteOnCalls: Array<{ midiNote: number; velocity: number; time?: number }>;
  noteOffCalls: Array<{ midiNote: number; time?: number }>;
  allNotesOffCalls: number;
} {
  const sampler = {
    noteOnCalls: [] as Array<{
      midiNote: number;
      velocity: number;
      time?: number;
    }>,
    noteOffCalls: [] as Array<{ midiNote: number; time?: number }>,
    allNotesOffCalls: 0,
    noteOn(midiNote: number, velocity: number, time?: number) {
      sampler.noteOnCalls.push({ midiNote, velocity, time });
    },
    noteOff(midiNote: number, time?: number) {
      sampler.noteOffCalls.push({ midiNote, time });
    },
    allNotesOff() {
      sampler.allNotesOffCalls++;
    },
  };
  return sampler;
}

// ─── Test Timeline ────────────────────────────

function createTestTimeline(): MidiTimeline {
  const events: MidiEvent[] = [
    {
      type: "noteOn",
      time: 0,
      midiNote: 60,
      velocity: 80,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOff",
      time: 0.5,
      midiNote: 60,
      velocity: 0,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOn",
      time: 1.0,
      midiNote: 64,
      velocity: 90,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOff",
      time: 1.5,
      midiNote: 64,
      velocity: 0,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOn",
      time: 2.0,
      midiNote: 67,
      velocity: 100,
      partIndex: 1,
      channel: 1,
    },
    {
      type: "noteOff",
      time: 2.5,
      midiNote: 67,
      velocity: 0,
      partIndex: 1,
      channel: 1,
    },
  ];

  return {
    events,
    duration: 3.0,
    tempoMap: [{ measureIndex: 0, beat: 0, time: 0, bpm: 120 }],
    measureStartTimes: [0],
  };
}

function createMultiTempoTimeline(): MidiTimeline {
  const events: MidiEvent[] = [
    {
      type: "noteOn",
      time: 0,
      midiNote: 60,
      velocity: 80,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOff",
      time: 0.5,
      midiNote: 60,
      velocity: 0,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOn",
      time: 2.0,
      midiNote: 64,
      velocity: 80,
      partIndex: 0,
      channel: 0,
    },
    {
      type: "noteOff",
      time: 3.0,
      midiNote: 64,
      velocity: 0,
      partIndex: 0,
      channel: 0,
    },
  ];

  return {
    events,
    duration: 4.0,
    tempoMap: [
      { measureIndex: 0, beat: 0, time: 0, bpm: 120 },
      { measureIndex: 2, beat: 0, time: 2.0, bpm: 60 },
    ],
    measureStartTimes: [0, 1.0, 2.0],
  };
}

// ─── Tests ────────────────────────────────────

describe("PlaybackEngine", () => {
  let audioCtx: AudioContext;
  let setTime: (t: number) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    const mock = makeAudioContext();
    audioCtx = mock.ctx;
    setTime = mock.setTime;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("should start in stopped state", () => {
      const engine = new PlaybackEngine(audioCtx);
      expect(engine.getState()).toBe("stopped");
    });

    it("should have no timeline initially", () => {
      const engine = new PlaybackEngine(audioCtx);
      expect(engine.getTimeline()).toBeNull();
    });
  });

  describe("loadTimeline", () => {
    it("should emit loaded event with part count and duration", () => {
      const engine = new PlaybackEngine(audioCtx);
      const timeline = createTestTimeline();
      const sampler = createMockSampler();
      const samplers = new Map([[0, sampler as ISampler]]);

      const loadedEvents: LoadedEventDetail[] = [];
      engine.on("loaded", (detail) => loadedEvents.push(detail));

      engine.loadTimeline(timeline, samplers);

      expect(loadedEvents).toHaveLength(1);
      expect(loadedEvents[0]!.partCount).toBe(2);
      expect(loadedEvents[0]!.duration).toBe(3.0);
    });

    it("should store the timeline", () => {
      const engine = new PlaybackEngine(audioCtx);
      const timeline = createTestTimeline();
      engine.loadTimeline(timeline, new Map());
      expect(engine.getTimeline()).toBe(timeline);
    });

    it("does not silence preview notes when reloading while stopped", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);
      engine.loadTimeline(createTestTimeline(), samplers);

      sampler.noteOn(60, 80);
      engine.loadTimeline(createTestTimeline(), samplers);

      expect(sampler.allNotesOffCalls).toBe(0);
    });
  });

  describe("play", () => {
    it("should transition to playing state", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      const states: StateEventDetail[] = [];
      engine.on("state", (detail) => states.push(detail));

      engine.play();

      expect(engine.getState()).toBe("playing");
      expect(states).toHaveLength(1);
      expect(states[0]!.state).toBe("playing");
      expect(states[0]!.previousState).toBe("stopped");

      engine.stop();
    });

    it("should emit error when no timeline is loaded", () => {
      const engine = new PlaybackEngine(audioCtx);
      const errors: ErrorEventDetail[] = [];
      engine.on("error", (detail) => errors.push(detail));

      engine.play();

      expect(errors).toHaveLength(1);
      expect(errors[0]!.type).toBe("playback");
      expect(engine.getState()).toBe("stopped");
    });

    it("should schedule events to the sampler", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
      });
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);

      engine.loadTimeline(createTestTimeline(), samplers);
      engine.play();

      // The scheduler should have already scheduled some events
      expect(sampler.noteOnCalls.length).toBeGreaterThan(0);
      expect(sampler.noteOnCalls[0]!.midiNote).toBe(60);

      engine.stop();
    });

    it("should route events to correct part sampler", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
      });
      const sampler0 = createMockSampler();
      const sampler1 = createMockSampler();
      const samplers = new Map<number, ISampler>([
        [0, sampler0],
        [1, sampler1],
      ]);

      engine.loadTimeline(createTestTimeline(), samplers);
      engine.play();

      // Part 0 notes: C4 (60), E4 (64)
      expect(sampler0.noteOnCalls.some((c) => c.midiNote === 60)).toBe(true);
      expect(sampler0.noteOnCalls.some((c) => c.midiNote === 64)).toBe(true);
      // Part 1 note: G4 (67)
      expect(sampler1.noteOnCalls.some((c) => c.midiNote === 67)).toBe(true);

      engine.stop();
    });
  });

  describe("pause", () => {
    it("should transition to paused state", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();

      const states: StateEventDetail[] = [];
      engine.on("state", (detail) => states.push(detail));

      engine.pause();

      expect(engine.getState()).toBe("paused");
      expect(states).toHaveLength(1);
      expect(states[0]!.state).toBe("paused");
      expect(states[0]!.previousState).toBe("playing");
    });

    it("should silence all samplers on pause", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
      });
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);

      engine.loadTimeline(createTestTimeline(), samplers);
      engine.play();
      engine.pause();

      expect(sampler.allNotesOffCalls).toBeGreaterThan(0);
    });

    it("should be a no-op when not playing", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      const states: StateEventDetail[] = [];
      engine.on("state", (detail) => states.push(detail));

      engine.pause(); // Should do nothing when stopped

      expect(states).toHaveLength(0);
      expect(engine.getState()).toBe("stopped");
    });
  });

  describe("stop", () => {
    it("should transition to stopped state from playing", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();

      const states: StateEventDetail[] = [];
      engine.on("state", (detail) => states.push(detail));

      engine.stop();

      expect(engine.getState()).toBe("stopped");
      expect(states).toHaveLength(1);
      expect(states[0]!.state).toBe("stopped");
    });

    it("should transition to stopped state from paused", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();
      engine.pause();

      const states: StateEventDetail[] = [];
      engine.on("state", (detail) => states.push(detail));

      engine.stop();

      expect(engine.getState()).toBe("stopped");
    });

    it("should reset playhead to beginning", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();

      setTime(1.5);
      vi.advanceTimersByTime(25);

      engine.stop();

      const position = engine.getPlayheadPosition();
      expect(position.timeSeconds).toBe(0);
    });

    it("should be a no-op when already stopped", () => {
      const engine = new PlaybackEngine(audioCtx);
      const states: StateEventDetail[] = [];
      engine.on("state", (detail) => states.push(detail));

      engine.stop();

      expect(states).toHaveLength(0);
    });

    it("should still silence samplers when already stopped", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);

      engine.loadTimeline(createTestTimeline(), samplers);
      engine.stop();

      expect(engine.getState()).toBe("stopped");
      expect(sampler.allNotesOffCalls).toBeGreaterThan(0);
    });
  });

  describe("seek", () => {
    it("should update playhead position when paused", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      engine.seek(1.5);

      const position = engine.getPlayheadPosition();
      expect(position.timeSeconds).toBe(1.5);
    });

    it("should clamp seek to timeline duration", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      engine.seek(100);

      const position = engine.getPlayheadPosition();
      expect(position.timeSeconds).toBe(3.0); // clamped to duration
    });

    it("should clamp seek to zero for negative values", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      engine.seek(-5);

      const position = engine.getPlayheadPosition();
      expect(position.timeSeconds).toBe(0);
    });

    it("should emit playhead event on seek", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      const positions: PlayheadPosition[] = [];
      engine.on("playhead", (detail) => positions.push(detail.position));

      engine.seek(1.0);

      expect(positions).toHaveLength(1);
      expect(positions[0]!.timeSeconds).toBe(1.0);
    });

    it("should continue playing from new position when playing", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
      });
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);

      engine.loadTimeline(createTestTimeline(), samplers);
      engine.play();

      sampler.noteOnCalls.length = 0;
      sampler.noteOffCalls.length = 0;

      // Seek to near the end — should still schedule remaining events
      engine.seek(1.5);

      // Sampler should have been silenced and new events scheduled
      expect(sampler.allNotesOffCalls).toBeGreaterThan(0);
      expect(engine.getState()).toBe("playing");

      engine.stop();
    });
  });

  describe("setPlayheadResolver", () => {
    it("should use the resolver to map score time to measure/beat", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      engine.setPlayheadResolver((scoreTime) => ({
        measureIndex: 7,
        beat: scoreTime * 2,
      }));

      engine.seek(1.5);

      const position = engine.getPlayheadPosition();
      expect(position.measureIndex).toBe(7);
      expect(position.beat).toBeCloseTo(3.0);
      expect(position.timeSeconds).toBe(1.5);
    });

    it("should fall back to the per-bar map when resolver returns null", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      engine.setPlayheadResolver(() => null);
      engine.seek(1.0);

      const position = engine.getPlayheadPosition();
      // 120 bpm, single measure starting at 0 → beat 2 at t=1s.
      expect(position.measureIndex).toBe(0);
      expect(position.beat).toBeCloseTo(2.0);
    });

    it("should persist the resolver across loadTimeline", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.setPlayheadResolver(() => ({ measureIndex: 3, beat: 1.25 }));

      engine.loadTimeline(createTestTimeline(), new Map());
      engine.seek(0.5);

      const position = engine.getPlayheadPosition();
      expect(position.measureIndex).toBe(3);
      expect(position.beat).toBeCloseTo(1.25);
    });
  });

  describe("click track", () => {
    it("should fire scheduled clicks through the callback during playback", () => {
      const engine = new PlaybackEngine(audioCtx, { scheduleAheadTime: 10, tickIntervalMs: 25 });
      engine.loadTimeline(createTestTimeline(), new Map());

      const clicks: Array<{ time: number; accented: boolean }> = [];
      engine.setClickCallback((time, accented) => clicks.push({ time, accented }));
      engine.setClickTrack([
        { time: 0, accented: true },
        { time: 1.0, accented: false },
        { time: 2.0, accented: false },
      ]);

      engine.play();

      // All three clicks are within the 10s look-ahead window of the first tick.
      expect(clicks).toHaveLength(3);
      expect(clicks[0]!.accented).toBe(true);
      expect(clicks[1]!.accented).toBe(false);

      engine.stop();
    });

    it("should not fire clicks when no callback is set", () => {
      const engine = new PlaybackEngine(audioCtx, { scheduleAheadTime: 10, tickIntervalMs: 25 });
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.setClickTrack([{ time: 0, accented: true }]);

      // No callback wired → play must not throw.
      expect(() => engine.play()).not.toThrow();

      engine.stop();
    });

    it("should persist the click track and callback across loadTimeline", () => {
      const engine = new PlaybackEngine(audioCtx, { scheduleAheadTime: 10, tickIntervalMs: 25 });
      const clicks: number[] = [];
      engine.setClickCallback((time) => clicks.push(time));
      engine.setClickTrack([{ time: 0, accented: true }]);

      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();

      expect(clicks.length).toBeGreaterThan(0);

      engine.stop();
    });
  });

  describe("setTempo", () => {
    it("should scale playback speed", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
      });
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);

      const timeline = createTestTimeline(); // original BPM: 120
      engine.loadTimeline(timeline, samplers);

      engine.setTempo(240); // 2x speed

      engine.play();

      // At 2x tempo, events should be scheduled at half the audio time
      const noteOn60 = sampler.noteOnCalls.find((c) => c.midiNote === 60);
      expect(noteOn60).toBeDefined();

      engine.stop();
    });

    it("should ignore non-positive BPM", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      engine.setTempo(0);
      engine.setTempo(-100);

      // Should not crash, state unchanged
      expect(engine.getState()).toBe("stopped");
    });
  });

  describe("getPlayheadPosition", () => {
    it("should return measure and beat from tempo map", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      // At time 0: measure 0, beat 0
      const pos = engine.getPlayheadPosition();
      expect(pos.measureIndex).toBe(0);
      expect(pos.beat).toBeCloseTo(0);
      expect(pos.timeSeconds).toBe(0);
    });

    it("should compute beat correctly at 120 BPM", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());

      // Seek to 1.0s — at 120 BPM, that's 2 beats
      engine.seek(1.0);

      const pos = engine.getPlayheadPosition();
      expect(pos.beat).toBeCloseTo(2.0);
      expect(pos.timeSeconds).toBe(1.0);
    });

    it("should use correct tempo entry for multi-tempo timeline", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createMultiTempoTimeline(), new Map());

      // Seek to 2.5s — second tempo entry starts at 2.0s with 60 BPM
      engine.seek(2.5);

      const pos = engine.getPlayheadPosition();
      expect(pos.measureIndex).toBe(2);
      // 0.5s at 60 BPM = 0.5 beats
      expect(pos.beat).toBeCloseTo(0.5);
    });
  });

  describe("event emitter", () => {
    it("should support on/off for listeners", () => {
      const engine = new PlaybackEngine(audioCtx);
      const states: PlaybackState[] = [];
      const callback = (detail: StateEventDetail): void => {
        states.push(detail.state);
      };

      engine.on("state", callback);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();
      engine.off("state", callback);
      engine.stop();

      // Only the "playing" state should have been captured
      expect(states).toEqual(["playing"]);
    });

    it("should not crash if listener throws", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.on("state", () => {
        throw new Error("Listener error");
      });

      engine.loadTimeline(createTestTimeline(), new Map());

      // Should not throw
      expect(() => engine.play()).not.toThrow();

      engine.stop();
    });
  });

  describe("auto-stop at end", () => {
    it("should stop when playhead reaches end of timeline", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
        playheadIntervalMs: 16,
      });
      engine.loadTimeline(createTestTimeline(), new Map());

      const states: PlaybackState[] = [];
      engine.on("state", (detail) => states.push(detail.state));

      engine.play();

      // Advance past the timeline duration (3.0s)
      setTime(4.0);
      vi.advanceTimersByTime(20);

      expect(states).toContain("stopped");
      expect(engine.getState()).toBe("stopped");
    });
  });

  describe("resume from pause", () => {
    it("should resume from paused position", () => {
      const engine = new PlaybackEngine(audioCtx, {
        scheduleAheadTime: 10,
        tickIntervalMs: 25,
      });
      const sampler = createMockSampler();
      const samplers = new Map<number, ISampler>([[0, sampler]]);

      engine.loadTimeline(createTestTimeline(), samplers);
      engine.play();

      // Advance to 0.8s and pause
      setTime(0.8);
      vi.advanceTimersByTime(25);
      engine.pause();

      // Reset tracking
      sampler.noteOnCalls.length = 0;

      // Resume — should continue from ~0.8s
      engine.play();

      // Should schedule remaining events (1.0s event and beyond)
      expect(engine.getState()).toBe("playing");

      engine.stop();
    });
  });

  describe("dispose", () => {
    it("should stop playback and clear listeners", () => {
      const engine = new PlaybackEngine(audioCtx);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();

      const states: PlaybackState[] = [];
      engine.on("state", (detail) => states.push(detail.state));

      engine.dispose();

      expect(engine.getState()).toBe("stopped");

      // Listener should have been cleared, so playing again after loading
      // should not trigger the callback
      states.length = 0;
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();
      expect(states).toHaveLength(0);

      engine.stop();
    });
  });

  describe("suspended AudioContext", () => {
    it("should call resume on suspended AudioContext when playing", () => {
      const { ctx } = makeAudioContext();
      (ctx as { state: string }).state = "suspended";

      const engine = new PlaybackEngine(ctx);
      engine.loadTimeline(createTestTimeline(), new Map());
      engine.play();

      expect(ctx.resume).toHaveBeenCalled();

      engine.stop();
    });
  });

  describe("sticky technique state (chase on start/seek)", () => {
    // A mock sampler that records technique-related calls.
    function createTechniqueSampler() {
      const sampler = {
        programCalls: [] as number[],
        controlCalls: [] as Array<{ cc: number; value: number }>,
        resetCalls: 0,
        noteOn() {},
        noteOff() {},
        allNotesOff() {},
        setProgram(program: number) {
          sampler.programCalls.push(program);
        },
        sendControl(cc: number, value: number) {
          sampler.controlCalls.push({ cc, value });
        },
        resetTechniqueState() {
          sampler.resetCalls++;
        },
      };
      return sampler;
    }

    // Timeline: part 0 goes pizz (program 45) at 0.5s, mutes (CC 74/71/11) at
    // 0.5s, then arco (program 40) at 2.0s. Notes interleaved.
    function techniqueTimeline(): MidiTimeline {
      const events: MidiEvent[] = [
        { type: "noteOn", time: 0, midiNote: 60, velocity: 80, partIndex: 0, channel: 0 },
        { type: "programChange", time: 0.5, midiNote: 0, velocity: 0, partIndex: 0, channel: 0, program: 45 },
        { type: "controlChange", time: 0.5, midiNote: 0, velocity: 0, partIndex: 0, channel: 0, cc: 74, value: 44 },
        { type: "controlChange", time: 0.5, midiNote: 0, velocity: 0, partIndex: 0, channel: 0, cc: 71, value: 70 },
        { type: "controlChange", time: 0.5, midiNote: 0, velocity: 0, partIndex: 0, channel: 0, cc: 11, value: 105 },
        { type: "noteOn", time: 1.0, midiNote: 62, velocity: 80, partIndex: 0, channel: 0 },
        { type: "programChange", time: 2.0, midiNote: 0, velocity: 0, partIndex: 0, channel: 0, program: 40 },
        { type: "noteOn", time: 2.5, midiNote: 64, velocity: 80, partIndex: 0, channel: 0 },
      ];
      return {
        events,
        duration: 3.0,
        tempoMap: [{ measureIndex: 0, beat: 0, time: 0, bpm: 120 }],
        measureStartTimes: [0],
      };
    }

    it("applies pizz + mute state when starting inside the region", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createTechniqueSampler();
      engine.loadTimeline(techniqueTimeline(), new Map([[0, sampler as unknown as ISampler]]));

      // Start at 1.0s — inside the pizz + muted region (markings were at 0.5s).
      engine.play(1.0);

      expect(sampler.resetCalls).toBe(1); // reset to baseline first
      expect(sampler.programCalls).toContain(45); // chased pizz
      expect(sampler.controlCalls).toEqual([
        { cc: 74, value: 44 },
        { cc: 71, value: 70 },
        { cc: 11, value: 105 },
      ]);

      engine.stop();
    });

    it("chases the latest program when starting after arco restores", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createTechniqueSampler();
      engine.loadTimeline(techniqueTimeline(), new Map([[0, sampler as unknown as ISampler]]));

      // Start at 2.5s — after the arco programChange (2.0s).
      engine.play(2.5);

      // Last program <= 2.5 is 40 (arco), applied after the baseline reset.
      expect(sampler.programCalls[sampler.programCalls.length - 1]).toBe(40);

      engine.stop();
    });

    it("resets to baseline with no chased program when starting at 0", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createTechniqueSampler();
      engine.loadTimeline(techniqueTimeline(), new Map([[0, sampler as unknown as ISampler]]));

      // Start at 0 — before any marking. Reset runs; no program/cc chased.
      engine.play(0);

      expect(sampler.resetCalls).toBe(1);
      expect(sampler.programCalls).toHaveLength(0);
      expect(sampler.controlCalls).toHaveLength(0);

      engine.stop();
    });

    it("applies chased state when seeking during playback", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createTechniqueSampler();
      engine.loadTimeline(techniqueTimeline(), new Map([[0, sampler as unknown as ISampler]]));

      engine.play(0);
      sampler.programCalls.length = 0;
      sampler.controlCalls.length = 0;
      sampler.resetCalls = 0;

      // Seek into the pizz + muted region.
      engine.seek(1.2);

      expect(sampler.resetCalls).toBe(1);
      expect(sampler.programCalls).toContain(45);
      expect(sampler.controlCalls).toContainEqual({ cc: 74, value: 44 });

      engine.stop();
    });

    it("routes notes and chased controls independently by playback lane", () => {
      const engine = new PlaybackEngine(audioCtx);
      const upper = createTechniqueSampler();
      const lower = createTechniqueSampler();
      const upperNoteOn = vi.spyOn(upper, "noteOn");
      const lowerNoteOn = vi.spyOn(lower, "noteOn");
      const timeline: MidiTimeline = {
        events: [
          {
            type: "controlChange",
            time: 0,
            midiNote: 0,
            velocity: 0,
            partIndex: 0,
            playbackLaneId: "upper",
            channel: 0,
            cc: 11,
            value: 52,
          },
          {
            type: "controlChange",
            time: 0,
            midiNote: 0,
            velocity: 0,
            partIndex: 0,
            playbackLaneId: "lower",
            channel: 0,
            cc: 11,
            value: 112,
          },
          {
            type: "noteOn",
            time: 0,
            midiNote: 60,
            velocity: 52,
            partIndex: 0,
            playbackLaneId: "upper",
            channel: 0,
          },
          {
            type: "noteOn",
            time: 0,
            midiNote: 48,
            velocity: 98,
            partIndex: 0,
            playbackLaneId: "lower",
            channel: 0,
          },
        ],
        duration: 1,
        tempoMap: [{ measureIndex: 0, beat: 0, time: 0, bpm: 120 }],
        measureStartTimes: [0],
      };
      engine.loadTimeline(
        timeline,
        new Map([
          ["upper", upper as unknown as ISampler],
          ["lower", lower as unknown as ISampler],
        ]),
      );

      engine.play(0);

      expect(upper.controlCalls).toContainEqual({ cc: 11, value: 52 });
      expect(lower.controlCalls).toContainEqual({ cc: 11, value: 112 });
      expect(upperNoteOn).toHaveBeenCalledWith(60, 52, expect.any(Number), undefined);
      expect(lowerNoteOn).toHaveBeenCalledWith(48, 98, expect.any(Number), undefined);
      engine.stop();
    });

    it("skips the chase entirely when the timeline has no technique events", () => {
      const engine = new PlaybackEngine(audioCtx);
      const sampler = createTechniqueSampler();
      engine.loadTimeline(createTestTimeline(), new Map([[0, sampler as unknown as ISampler]]));

      engine.play(1.0);

      expect(sampler.resetCalls).toBe(0);
      expect(sampler.programCalls).toHaveLength(0);

      engine.stop();
    });
  });
});

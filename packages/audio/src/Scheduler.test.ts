import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "./Scheduler";
import type { MidiEvent, ScheduleCallback } from "./types";

// ─── Helpers ──────────────────────────────────

function makeEvent(time: number, type: "noteOn" | "noteOff" = "noteOn", midiNote = 60): MidiEvent {
  return {
    type,
    time,
    midiNote,
    velocity: 80,
    partIndex: 0,
    channel: 0,
  };
}

function makeEvents(times: number[]): readonly MidiEvent[] {
  const events: MidiEvent[] = [];
  for (const t of times) {
    events.push(makeEvent(t, "noteOn"));
    events.push(makeEvent(t + 0.4, "noteOff"));
  }
  return events.sort((a, b) => a.time - b.time);
}

describe("Scheduler", () => {
  let audioTime: number;
  const getAudioTime = (): number => audioTime;

  beforeEach(() => {
    audioTime = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should schedule events within the lookahead window", () => {
    const events = makeEvents([0, 0.5, 1.0, 2.0, 6.0]);
    const scheduled: Array<{ event: MidiEvent; audioTime: number }> = [];
    const callback: ScheduleCallback = (event, at) => {
      scheduled.push({ event, audioTime: at });
    };

    const scheduler = new Scheduler(events, { scheduleAheadTime: 5, tickIntervalMs: 25 }, callback, getAudioTime);

    scheduler.start(0);

    // First tick happens immediately — should schedule events in [0, 5)
    expect(scheduled.length).toBeGreaterThan(0);

    // Events at 0, 0.4, 0.5, 0.9, 1.0, 1.4, 2.0, 2.4 are within 5s window
    const scheduledTimes = scheduled.map((s) => s.event.time);
    expect(scheduledTimes).toContain(0);
    expect(scheduledTimes).toContain(0.5);
    expect(scheduledTimes).toContain(1.0);
    expect(scheduledTimes).toContain(2.0);
    // 6.0 is beyond the window
    expect(scheduledTimes).not.toContain(6.0);

    scheduler.stop();
  });

  it("should schedule remaining events as time advances", () => {
    const events = makeEvents([0, 3.0, 7.0]);
    const scheduled: MidiEvent[] = [];
    const callback: ScheduleCallback = (event) => {
      scheduled.push(event);
    };

    const scheduler = new Scheduler(events, { scheduleAheadTime: 5, tickIntervalMs: 25 }, callback, getAudioTime);

    scheduler.start(0);

    // Initial: events at 0, 0.4, 3.0, 3.4 should be scheduled (within 5s)
    const initialCount = scheduled.length;
    expect(initialCount).toBe(4);

    // Advance time to 3s — window extends to 8s, should pick up 7.0 and 7.4
    audioTime = 3;
    vi.advanceTimersByTime(25);

    expect(scheduled.length).toBe(6);
    expect(scheduled.some((e) => e.time === 7.0)).toBe(true);

    scheduler.stop();
  });

  it("should not schedule events before seek position", () => {
    const events = makeEvents([0, 1.0, 3.0, 5.0]);
    const scheduled: MidiEvent[] = [];
    const callback: ScheduleCallback = (event) => {
      scheduled.push(event);
    };

    const scheduler = new Scheduler(events, { scheduleAheadTime: 5, tickIntervalMs: 25 }, callback, getAudioTime);

    // Start from score-time 2.0 — events at 0 and 1.0 should be skipped
    scheduler.start(2.0);

    const scheduledTimes = scheduled.map((s) => s.time);
    expect(scheduledTimes).not.toContain(0);
    expect(scheduledTimes).not.toContain(1.0);
    expect(scheduledTimes).toContain(3.0);
    expect(scheduledTimes).toContain(5.0);

    scheduler.stop();
  });

  it("should stop scheduling when stop() is called", () => {
    const events = makeEvents([0, 1.0, 3.0, 7.0]);
    let callCount = 0;
    const callback: ScheduleCallback = () => {
      callCount++;
    };

    const scheduler = new Scheduler(events, { scheduleAheadTime: 5, tickIntervalMs: 25 }, callback, getAudioTime);

    scheduler.start(0);
    const countAfterStart = callCount;

    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);

    // Advance time — no more events should be scheduled
    audioTime = 10;
    vi.advanceTimersByTime(100);

    expect(callCount).toBe(countAfterStart);
  });

  it("should report isRunning correctly", () => {
    const scheduler = new Scheduler([], { scheduleAheadTime: 5, tickIntervalMs: 25 }, () => {}, getAudioTime);

    expect(scheduler.isRunning).toBe(false);
    scheduler.start(0);
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it("should compute currentScoreTime based on audioContext time", () => {
    const scheduler = new Scheduler([], { scheduleAheadTime: 5, tickIntervalMs: 25 }, () => {}, getAudioTime);

    audioTime = 10;
    scheduler.start(0);

    // Audio time started at 10. Advance to 13 → 3 seconds elapsed.
    audioTime = 13;
    expect(scheduler.currentScoreTime()).toBeCloseTo(3.0);

    scheduler.stop();
  });

  it("should handle tempo scaling", () => {
    const events = makeEvents([0, 2.0, 4.0, 8.0]);
    const scheduled: Array<{ event: MidiEvent; audioTime: number }> = [];
    const callback: ScheduleCallback = (event, at) => {
      scheduled.push({ event, audioTime: at });
    };

    const scheduler = new Scheduler(events, { scheduleAheadTime: 10, tickIntervalMs: 25 }, callback, getAudioTime);

    // 2x tempo: score events happen at half the audio time
    scheduler.start(0, 2.0);

    // At 2x tempo, score-time 8.0 needs only 4.0 audio seconds,
    // so all events should be within the 10s window
    const scheduledTimes = scheduled.map((s) => s.event.time);
    expect(scheduledTimes).toContain(8.0);

    // Event at score-time 4.0 should map to audio-time 2.0
    const event4 = scheduled.find((s) => s.event.time === 4.0);
    expect(event4).toBeDefined();
    expect(event4!.audioTime).toBeCloseTo(2.0);

    scheduler.stop();
  });

  it("should update tempo scale without a time jump", () => {
    const scheduler = new Scheduler([], { scheduleAheadTime: 5, tickIntervalMs: 25 }, () => {}, getAudioTime);

    audioTime = 0;
    scheduler.start(0, 1.0);

    // After 2 audio seconds at 1x
    audioTime = 2;
    const timeBefore = scheduler.currentScoreTime();
    expect(timeBefore).toBeCloseTo(2.0);

    // Switch to 2x tempo — score time should not jump
    scheduler.setTempoScale(2.0);
    expect(scheduler.currentScoreTime()).toBeCloseTo(2.0);

    // After 1 more audio second at 2x, score time should advance by 2
    audioTime = 3;
    expect(scheduler.currentScoreTime()).toBeCloseTo(4.0);

    scheduler.stop();
  });

  it("should not start twice if already running", () => {
    const events = makeEvents([0, 1.0]);
    let callCount = 0;
    const callback: ScheduleCallback = () => {
      callCount++;
    };

    const scheduler = new Scheduler(events, { scheduleAheadTime: 5, tickIntervalMs: 25 }, callback, getAudioTime);

    scheduler.start(0);
    const firstCount = callCount;

    // Second start should be a no-op
    scheduler.start(0);
    expect(callCount).toBe(firstCount);

    scheduler.stop();
  });

  describe("click track", () => {
    it("should schedule clicks within the lookahead window at precise audio times", () => {
      const clicked: Array<{ audioTime: number; accented: boolean }> = [];
      const scheduler = new Scheduler([], { scheduleAheadTime: 5, tickIntervalMs: 25 }, () => {}, getAudioTime, {
        events: [
          { time: 0, accented: true },
          { time: 1.0, accented: false },
          { time: 2.0, accented: false },
          { time: 6.0, accented: true },
        ],
        onClick: (at, accented) => clicked.push({ audioTime: at, accented }),
      });

      scheduler.start(0);

      const times = clicked.map((c) => c.audioTime);
      expect(times).toContain(0);
      expect(times).toContain(1.0);
      expect(times).toContain(2.0);
      // 6.0 is beyond the 5s window
      expect(times).not.toContain(6.0);
      // Downbeat is accented; others are not
      expect(clicked.find((c) => c.audioTime === 0)!.accented).toBe(true);
      expect(clicked.find((c) => c.audioTime === 1.0)!.accented).toBe(false);

      scheduler.stop();
    });

    it("should not schedule clicks before the seek position", () => {
      const clicked: number[] = [];
      const scheduler = new Scheduler([], { scheduleAheadTime: 5, tickIntervalMs: 25 }, () => {}, getAudioTime, {
        events: [
          { time: 0, accented: true },
          { time: 1.0, accented: false },
          { time: 3.0, accented: false },
        ],
        onClick: (at) => clicked.push(at),
      });

      scheduler.start(2.0);

      // Only the score-3.0 click is at/after the seek; it maps to audio-time
      // 1.0 (startScoreTime 2.0 → startAudioTime 0). The 0 / 1.0 clicks are skipped.
      expect(clicked).toHaveLength(1);
      expect(clicked[0]!).toBeCloseTo(1.0);

      scheduler.stop();
    });

    it("should map click score time to audio time under tempo scaling", () => {
      const clicked: Array<{ audioTime: number; accented: boolean }> = [];
      const scheduler = new Scheduler([], { scheduleAheadTime: 10, tickIntervalMs: 25 }, () => {}, getAudioTime, {
        events: [{ time: 4.0, accented: false }],
        onClick: (at, accented) => clicked.push({ audioTime: at, accented }),
      });

      // 2x tempo: score-time 4.0 lands at audio-time 2.0
      scheduler.start(0, 2.0);

      expect(clicked).toHaveLength(1);
      expect(clicked[0]!.audioTime).toBeCloseTo(2.0);

      scheduler.stop();
    });

    it("should play no clicks when no click track is supplied", () => {
      const events = makeEvents([0, 1.0]);
      let scheduledCount = 0;
      const scheduler = new Scheduler(
        events,
        { scheduleAheadTime: 5, tickIntervalMs: 25 },
        () => scheduledCount++,
        getAudioTime,
      );

      // No throw, notes still scheduled.
      scheduler.start(0);
      expect(scheduledCount).toBeGreaterThan(0);

      scheduler.stop();
    });
  });
});

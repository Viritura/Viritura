import { describe, it, expect } from "vitest";
import {
  playbackReducer,
  initialPlaybackState,
  DEFAULT_TEMPO,
  DEFAULT_VOLUME,
  type PlaybackState,
  type PlaybackAction,
} from "./playbackReducer";
import type { Score } from "@viritura/core";
import { generateTimeline } from "@viritura/midi";
import { createPlayheadResolver, sourceMeasureBeatToSeconds } from "./playheadResolver";

function defaultState(): PlaybackState {
  return initialPlaybackState();
}

describe("playhead resolver", () => {
  it("returns original score measure indices on repeated passes", () => {
    const timeline = generateTimeline({
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }], repeatStart: {} },
          { repeatEnd: { times: 2 } },
          {},
        ],
      },
      parts: [],
    } as Score);
    const resolve = createPlayheadResolver(timeline);

    expect(resolve(timeline.model.timeAtBeat(9))).toEqual({ measureIndex: 0, beat: 1 });
    expect(resolve(timeline.model.timeAtBeat(14.5))).toEqual({ measureIndex: 1, beat: 2.5 });
  });

  it("maps a selected measure after a repeat to its expanded performance position", () => {
    const timeline = generateTimeline({
      mnx: { version: 1 },
      global: {
        measures: [
          { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }], repeatStart: {} },
          { repeatEnd: { times: 2 } },
          {},
        ],
      },
      parts: [],
    } as Score);

    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 1, 2]);
    expect(sourceMeasureBeatToSeconds(timeline, 2, 1.5)).toBeCloseTo(
      timeline.model.timeAtBeat(timeline.measureStartBeats[4]! + 1.5),
    );
    expect(sourceMeasureBeatToSeconds(timeline, 2, 0)).not.toBe(timeline.measureStartTimes[2]);
  });
});

describe("playbackReducer", () => {
  describe("initial state", () => {
    it("returns correct defaults", () => {
      const state = defaultState();
      expect(state.status).toBe("stopped");
      expect(state.playheadPosition).toBeNull();
      expect(state.duration).toBe(0);
      expect(state.currentTempo).toBe(DEFAULT_TEMPO);
      expect(state.scoreTempo).toBe(DEFAULT_TEMPO);
      expect(state.volume).toBe(DEFAULT_VOLUME);
      expect(state.metronomeEnabled).toBe(false);
      expect(state.countInEnabled).toBe(false);
      expect(state.loop).toBeNull();
    });
  });

  describe("PLAY", () => {
    it("transitions from stopped to playing", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "PLAY" });
      expect(next.status).toBe("playing");
    });

    it("transitions from paused to playing", () => {
      const state: PlaybackState = { ...defaultState(), status: "paused" };
      const next = playbackReducer(state, { type: "PLAY" });
      expect(next.status).toBe("playing");
    });

    it("returns same reference when already playing", () => {
      const state: PlaybackState = { ...defaultState(), status: "playing" };
      const next = playbackReducer(state, { type: "PLAY" });
      expect(next).toBe(state);
    });
  });

  describe("PAUSE", () => {
    it("transitions from playing to paused", () => {
      const state: PlaybackState = { ...defaultState(), status: "playing" };
      const next = playbackReducer(state, { type: "PAUSE" });
      expect(next.status).toBe("paused");
    });

    it("returns same reference when not playing", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "PAUSE" });
      expect(next).toBe(state);
    });

    it("returns same reference when paused", () => {
      const state: PlaybackState = { ...defaultState(), status: "paused" };
      const next = playbackReducer(state, { type: "PAUSE" });
      expect(next).toBe(state);
    });
  });

  describe("STOP", () => {
    it("transitions from playing to stopped and clears playhead", () => {
      const state: PlaybackState = {
        ...defaultState(),
        status: "playing",
        playheadPosition: { measureIndex: 2, beat: 3, timeSeconds: 5.5 },
      };
      const next = playbackReducer(state, { type: "STOP" });
      expect(next.status).toBe("stopped");
      expect(next.playheadPosition).toBeNull();
    });

    it("transitions from paused to stopped", () => {
      const state: PlaybackState = {
        ...defaultState(),
        status: "paused",
        playheadPosition: { measureIndex: 1, beat: 1, timeSeconds: 2 },
      };
      const next = playbackReducer(state, { type: "STOP" });
      expect(next.status).toBe("stopped");
      expect(next.playheadPosition).toBeNull();
    });

    it("returns same reference when already stopped with no playhead", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "STOP" });
      expect(next).toBe(state);
    });

    it("clears playhead when stopped but playhead exists", () => {
      const state: PlaybackState = {
        ...defaultState(),
        status: "stopped",
        playheadPosition: { measureIndex: 0, beat: 2, timeSeconds: 1 },
      };
      const next = playbackReducer(state, { type: "STOP" });
      expect(next.playheadPosition).toBeNull();
    });
  });

  describe("SEEK", () => {
    it("sets playhead to the requested score time immediately", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SEEK", seconds: 4 });
      expect(next.playheadPosition).not.toBeNull();
      expect(next.playheadPosition!.timeSeconds).toBe(4);
    });

    it("clamps negative score time to 0", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SEEK", seconds: -5 });
      expect(next.playheadPosition!.timeSeconds).toBe(0);
    });

    it("preserves current status", () => {
      const state: PlaybackState = { ...defaultState(), status: "playing" };
      const next = playbackReducer(state, { type: "SEEK", seconds: 8 });
      expect(next.status).toBe("playing");
    });

    it("accepts the engine-resolved musical position after an optimistic seek", () => {
      const sought = playbackReducer(defaultState(), {
        type: "SEEK",
        seconds: 8,
      });
      const resolvedPosition = {
        measureIndex: 3,
        beat: 1.5,
        timeSeconds: 8,
      };

      const resolved = playbackReducer(sought, {
        type: "SET_PLAYHEAD",
        position: resolvedPosition,
      });

      expect(resolved.playheadPosition).toEqual(resolvedPosition);
    });
  });

  describe("SET_TEMPO", () => {
    it("sets tempo within valid range", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_TEMPO", bpm: 140 });
      expect(next.currentTempo).toBe(140);
    });

    it("clamps tempo to minimum of 10", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_TEMPO", bpm: 3 });
      expect(next.currentTempo).toBe(10);
    });

    it("clamps tempo to maximum of 400", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_TEMPO", bpm: 999 });
      expect(next.currentTempo).toBe(400);
    });

    it("returns same reference when tempo unchanged", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_TEMPO", bpm: DEFAULT_TEMPO });
      expect(next).toBe(state);
    });
  });

  describe("SET_VOLUME", () => {
    it("sets volume within 0–1 range", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_VOLUME", volume: 0.5 });
      expect(next.volume).toBe(0.5);
    });

    it("clamps volume to minimum of 0", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_VOLUME", volume: -0.5 });
      expect(next.volume).toBe(0);
    });

    it("clamps volume to maximum of 1", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_VOLUME", volume: 1.5 });
      expect(next.volume).toBe(1);
    });

    it("returns same reference when volume unchanged", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_VOLUME", volume: DEFAULT_VOLUME });
      expect(next).toBe(state);
    });
  });

  describe("TOGGLE_METRONOME", () => {
    it("enables metronome when disabled", () => {
      const state = defaultState();
      expect(state.metronomeEnabled).toBe(false);
      const next = playbackReducer(state, { type: "TOGGLE_METRONOME" });
      expect(next.metronomeEnabled).toBe(true);
    });

    it("disables metronome when enabled", () => {
      const state: PlaybackState = { ...defaultState(), metronomeEnabled: true };
      const next = playbackReducer(state, { type: "TOGGLE_METRONOME" });
      expect(next.metronomeEnabled).toBe(false);
    });
  });

  describe("TOGGLE_COUNT_IN", () => {
    it("enables count-in when disabled", () => {
      const state = defaultState();
      expect(state.countInEnabled).toBe(false);
      const next = playbackReducer(state, { type: "TOGGLE_COUNT_IN" });
      expect(next.countInEnabled).toBe(true);
    });

    it("disables count-in when enabled", () => {
      const state: PlaybackState = { ...defaultState(), countInEnabled: true };
      const next = playbackReducer(state, { type: "TOGGLE_COUNT_IN" });
      expect(next.countInEnabled).toBe(false);
    });
  });

  describe("SET_LOOP", () => {
    it("sets a loop region", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_LOOP", start: 4, end: 16 });
      expect(next.loop).toEqual({ start: 4, end: 16 });
    });

    it("clamps start to minimum of 0", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_LOOP", start: -2, end: 8 });
      expect(next.loop!.start).toBe(0);
    });

    it("clamps end to be >= start", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_LOOP", start: 10, end: 5 });
      expect(next.loop!.start).toBe(10);
      expect(next.loop!.end).toBe(10);
    });

    it("returns same reference when loop unchanged", () => {
      const state: PlaybackState = {
        ...defaultState(),
        loop: { start: 4, end: 16 },
      };
      const next = playbackReducer(state, { type: "SET_LOOP", start: 4, end: 16 });
      expect(next).toBe(state);
    });
  });

  describe("CLEAR_LOOP", () => {
    it("clears an active loop", () => {
      const state: PlaybackState = {
        ...defaultState(),
        loop: { start: 0, end: 8 },
      };
      const next = playbackReducer(state, { type: "CLEAR_LOOP" });
      expect(next.loop).toBeNull();
    });

    it("returns same reference when no loop set", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "CLEAR_LOOP" });
      expect(next).toBe(state);
    });
  });

  describe("SET_PLAYHEAD", () => {
    it("sets playhead position", () => {
      const state = defaultState();
      const position = { measureIndex: 3, beat: 2.5, timeSeconds: 8.1 };
      const next = playbackReducer(state, { type: "SET_PLAYHEAD", position });
      expect(next.playheadPosition).toEqual(position);
    });

    it("clears playhead when set to null", () => {
      const state: PlaybackState = {
        ...defaultState(),
        playheadPosition: { measureIndex: 1, beat: 1, timeSeconds: 2 },
      };
      const next = playbackReducer(state, { type: "SET_PLAYHEAD", position: null });
      expect(next.playheadPosition).toBeNull();
    });
  });

  describe("SET_DURATION", () => {
    it("sets duration", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_DURATION", duration: 45.5 });
      expect(next.duration).toBe(45.5);
    });

    it("clamps negative duration to 0", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_DURATION", duration: -10 });
      expect(next.duration).toBe(0);
    });

    it("returns same reference when duration unchanged", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_DURATION", duration: 0 });
      expect(next).toBe(state);
    });
  });

  describe("SET_SCORE_TEMPO", () => {
    it("sets score tempo", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_SCORE_TEMPO", tempo: 96 });
      expect(next.scoreTempo).toBe(96);
    });

    it("clamps to minimum of 10", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_SCORE_TEMPO", tempo: 1 });
      expect(next.scoreTempo).toBe(10);
    });

    it("clamps to maximum of 400", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_SCORE_TEMPO", tempo: 500 });
      expect(next.scoreTempo).toBe(400);
    });

    it("returns same reference when score tempo unchanged", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_SCORE_TEMPO", tempo: DEFAULT_TEMPO });
      expect(next).toBe(state);
    });
  });

  describe("SET_STATUS", () => {
    it("sets arbitrary status", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_STATUS", status: "loading" });
      expect(next.status).toBe("loading");
    });

    it("returns same reference when status unchanged", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "SET_STATUS", status: "stopped" });
      expect(next).toBe(state);
    });
  });

  describe("transport workflows", () => {
    it("play → pause → play round-trip", () => {
      let state = defaultState();
      state = playbackReducer(state, { type: "PLAY" });
      expect(state.status).toBe("playing");

      state = playbackReducer(state, { type: "PAUSE" });
      expect(state.status).toBe("paused");

      state = playbackReducer(state, { type: "PLAY" });
      expect(state.status).toBe("playing");
    });

    it("play → stop resets playhead", () => {
      let state = defaultState();
      state = playbackReducer(state, { type: "PLAY" });
      state = playbackReducer(state, {
        type: "SET_PLAYHEAD",
        position: { measureIndex: 5, beat: 2, timeSeconds: 10 },
      });
      expect(state.playheadPosition).not.toBeNull();

      state = playbackReducer(state, { type: "STOP" });
      expect(state.status).toBe("stopped");
      expect(state.playheadPosition).toBeNull();
    });

    it("seek while playing preserves playing status", () => {
      let state: PlaybackState = { ...defaultState(), status: "playing" };
      state = playbackReducer(state, { type: "SEEK", seconds: 16 });
      expect(state.status).toBe("playing");
      expect(state.playheadPosition!.timeSeconds).toBe(16);
    });

    it("tempo change during playback preserves status and position", () => {
      let state: PlaybackState = {
        ...defaultState(),
        status: "playing",
        playheadPosition: { measureIndex: 2, beat: 4, timeSeconds: 6 },
      };
      state = playbackReducer(state, { type: "SET_TEMPO", bpm: 160 });
      expect(state.status).toBe("playing");
      expect(state.currentTempo).toBe(160);
      expect(state.playheadPosition!.beat).toBe(4);
    });
  });

  describe("unknown action", () => {
    it("returns same state for unknown action type", () => {
      const state = defaultState();
      const next = playbackReducer(state, { type: "UNKNOWN" } as unknown as PlaybackAction);
      expect(next).toBe(state);
    });
  });
});

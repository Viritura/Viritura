import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackEngine } from "./PlaybackEngine";
import { SamplerGroup } from "./SamplerGroup";
import { Sf2Sampler } from "./Sf2Sampler";
import { createSamplerWorkletHarness } from "./sf2Scheduling/workletHarness.spec";
import type { ISampler, MidiEvent, MidiTimeline } from "./types";

// The upstream chord lane contract, without a dependency on the score model.
const chordLaneId = "viritura:derived:chords";
const chordChannel = 4;
const firstChord = [60, 64, 67];
const secondChord = [62, 65, 69];

describe.each([
  { scorePartCount: 0, facade: false },
  { scorePartCount: 2, facade: false },
  { scorePartCount: 32, facade: false },
  { scorePartCount: 2, facade: true },
])("derived chord lane ($scorePartCount score parts, numeric facade: $facade)", ({ scorePartCount, facade }) => {
  let engine: PlaybackEngine;
  let worklet: ReturnType<typeof createSamplerWorkletHarness>;
  let chordSampler: Sf2Sampler;
  let chordMixer: Sf2Sampler | SamplerGroup;
  let ordinarySampler: Sf2Sampler;
  let samplers: Map<number | string, ISampler>;
  let timeline: MidiTimeline;
  let errors: ReturnType<typeof vi.fn>;

  function tick(time: number) {
    worklet.advance(time);
    vi.advanceTimersByTime(25);
  }

  function attacks(channel: number, note: number) {
    return worklet.attacks.filter((attack) => attack.channel === channel && attack.note === note);
  }

  function expectChord(notes: readonly number[]) {
    expect(worklet.channels[chordChannel]!.voices).toEqual(new Set(notes));
  }

  function expectMixer(volume: number, pan: number) {
    const controls = worklet.channels[chordChannel]!.controllers;
    const value = Math.round(volume * 0x3fff);
    expect(controls.get(7)).toBe(value >> 7);
    expect(controls.get(39)).toBe(value & 0x7f);
    expect(controls.get(10)).toBe(Math.round((pan + 1) * 63.5));
    expect(worklet.outputNode.gain.value).toBe(0.35);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    worklet = createSamplerWorkletHarness();
    worklet.setClock(0);
    chordSampler = new Sf2Sampler(worklet.sf2Synth, chordChannel, 0);
    chordMixer = facade ? new SamplerGroup([chordSampler]) : chordSampler;
    ordinarySampler = new Sf2Sampler(worklet.sf2Synth, 0, 40);
    samplers = new Map<number | string, ISampler>([[chordLaneId, chordSampler]]);
    if (facade) samplers.set(scorePartCount, chordMixer);
    // Other score parts may rest; only the last ordinary part has events.
    if (scorePartCount > 0) samplers.set(scorePartCount - 1, ordinarySampler);
    const base = {
      partIndex: scorePartCount,
      playbackLaneId: chordLaneId,
      channel: 0,
      midiNote: 0,
      velocity: 80,
    };
    const events: MidiEvent[] = [
      ...firstChord.map((midiNote): MidiEvent => ({ ...base, type: "noteOn", time: 0, midiNote })),
      { ...base, type: "programChange", time: 0.25, program: 24 },
      { ...base, type: "controlChange", time: 0.25, cc: 11, value: 70 },
      ...secondChord.map((midiNote): MidiEvent => ({ ...base, type: "noteOn", time: 0.5, midiNote })),
      ...secondChord.map((midiNote): MidiEvent => ({ ...base, type: "noteOff", time: 0.75, midiNote })),
      ...firstChord.map((midiNote): MidiEvent => ({ ...base, type: "noteOff", time: 1, midiNote })),
    ];
    if (scorePartCount > 0) {
      const ordinary = { partIndex: scorePartCount - 1, channel: 0, midiNote: 60, velocity: 90 };
      events.push({ ...ordinary, type: "noteOn", time: 0 }, { ...ordinary, type: "noteOff", time: 1.5 });
    }
    timeline = {
      events: events.sort((a, b) => a.time - b.time),
      duration: 2,
      tempoMap: [{ measureIndex: 0, beat: 0, time: 0, bpm: 120 }],
      measureStartTimes: [0, 1],
    };
    engine = new PlaybackEngine(worklet.sf2Synth.context, { leadInTime: 0, scheduleAheadTime: 0.2 });
    errors = vi.fn();
    engine.on("error", errors);
    engine.loadTimeline(timeline, samplers);
    chordMixer.setVolume(0.4);
    chordMixer.setPan(-0.5);
    ordinarySampler.setVolume(0.8);
    ordinarySampler.setPan(0.5);
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
    expect(errors).not.toHaveBeenCalled();
  });

  function loadSustainedChord() {
    engine.dispose();
    engine = new PlaybackEngine(worklet.sf2Synth.context, { leadInTime: 0.1875, scheduleAheadTime: 0.3 });
    engine.on("error", errors);
    engine.loadTimeline(
      {
        ...timeline,
        chasePartIndices: [scorePartCount],
        duration: 5,
        events: timeline.events
          .map((event) => {
            if (event.playbackLaneId !== chordLaneId) return event;
            if (event.time === 0.5) return { ...event, time: 1 };
            if (event.time === 0.75) return { ...event, time: 2 };
            if (event.time === 1) return { ...event, time: 4 };
            return event;
          })
          .sort((a, b) => a.time - b.time),
      },
      samplers,
    );
  }

  function useUncancellableSampler(playbackMute = false) {
    samplers.set(chordLaneId, {
      noteOn: (note, velocity, time) => chordSampler.noteOn(note, velocity, time),
      noteOff: (note, time) => chordSampler.noteOff(note, time),
      allNotesOff: () => chordSampler.allNotesOff(),
      setVolume: (volume) => chordSampler.setVolume(volume),
      setPan: (pan) => chordSampler.setPan(pan),
      sendControl: (cc, value, time) => chordSampler.sendControl(cc, value, time),
      setProgram: (program, time) => chordSampler.setProgram(program, time),
      ...(playbackMute ? { setPlaybackMuted: (muted: boolean) => chordSampler.setPlaybackMuted(muted) } : {}),
    });
    if (facade) samplers.delete(scorePartCount);
  }

  it.each([90, 240])("retimes chased and ordinary queued attacks once during seek pre-roll at %s BPM", (bpm) => {
    loadSustainedChord();
    engine.play(1);
    engine.setTempo(bpm);
    expectChord([]);
    const onset = 0.1875 / (bpm / 120);
    tick(onset - 0.01);
    expectChord([]);
    tick(onset);
    expectChord([...firstChord, ...secondChord]);
    for (const note of [...firstChord, ...secondChord]) {
      expect(attacks(chordChannel, note)).toEqual([{ channel: chordChannel, note, time: onset }]);
    }
    expectMixer(0.4, -0.5);
    expect(worklet.channels[chordChannel]!.program).toBe(24);
    expect(worklet.channels[chordChannel]!.controllers.get(11)).toBe(70);
    const release = onset + 3 / (bpm / 120);
    for (let time = onset + 0.125; time < release; time += 0.125) tick(time);
    tick(release);
    expectChord([]);
    for (const note of [...firstChord, ...secondChord]) expect(attacks(chordChannel, note)).toHaveLength(1);
  });

  it.each(["play", "seek", "resume"] as const)(
    "keeps pending chased chords through repeated tempo edits on %s",
    (action) => {
      loadSustainedChord();
      if (action !== "play") {
        engine.play(1);
        if (action === "resume") {
          engine.pause();
          engine.seek(1);
        }
      }
      if (action === "seek") engine.seek(1);
      else engine.play(action === "resume" ? undefined : 1);
      engine.setTempo(240);
      engine.setTempo(90);
      tick(0.0625);
      engine.setTempo(240);
      engine.setTempo(90);
      tick(0.1875);
      expectChord([]);
      tick(0.25);
      expectChord([...firstChord, ...secondChord]);
      engine.setTempo(120);
      tick(0.375);
      for (const note of [...firstChord, ...secondChord]) expect(attacks(chordChannel, note)).toHaveLength(1);
      expectMixer(0.4, -0.5);
    },
  );

  it.each([false, true])(
    "retimes suppressed chased attacks before revealing the part (cancellable: %s)",
    (cancellable) => {
      loadSustainedChord();
      if (!cancellable) useUncancellableSampler();
      engine.setViewPartFilter(new Set());
      engine.play(1);
      engine.setTempo(60);
      tick(0.0625);
      engine.setTempo(120);
      engine.setTempo(60);
      expectChord([]);
      tick(0.1);
      engine.setViewPartFilter(new Set([scorePartCount]));
      tick(0.1875);
      expectChord([]);
      tick(0.374);
      expectChord([]);
      tick(0.375);
      expectChord([...firstChord, ...secondChord]);
      for (const note of [...firstChord, ...secondChord]) {
        expect(attacks(chordChannel, note)).toEqual([{ channel: chordChannel, note, time: 0.375 }]);
      }
      for (let time = 0.5; time < 6.375; time += 0.125) tick(time);
      tick(6.375);
      expectChord([]);
      for (const note of [...firstChord, ...secondChord]) expect(attacks(chordChannel, note)).toHaveLength(1);
    },
  );

  it.each([false, true])(
    "preserves chord mixer gain and view/solo exclusion through pre-roll tempo edits (excluded: %s)",
    (excluded) => {
      loadSustainedChord();
      chordMixer.setVolume(0);
      chordMixer.setPan(0.75);
      if (excluded) engine.setViewPartFilter(new Set());
      engine.play(1);
      engine.setTempo(90);
      tick(0.1875);
      tick(0.25);
      expectChord(excluded ? [] : [...firstChord, ...secondChord]);
      expectMixer(0, 0.75);
      if (excluded) engine.setViewPartFilter(new Set([scorePartCount]));
      chordMixer.setVolume(0.4);
      engine.setTempo(240);
      tick(0.375);
      expectChord([...firstChord, ...secondChord]);
      for (const note of [...firstChord, ...secondChord]) expect(attacks(chordChannel, note)).toHaveLength(1);
      expectMixer(0.4, 0.75);
    },
  );

  it.each(
    [0.5, 0.9].flatMap((keyUp) => [
      { keyUp, hidden: false, cancellable: true, playbackMute: true },
      { keyUp, hidden: true, cancellable: true, playbackMute: true },
      { keyUp, hidden: true, cancellable: false, playbackMute: false },
      { keyUp, hidden: true, cancellable: false, playbackMute: true },
    ]),
  )(
    "keeps a chased pedal-held chord's key-up after its attack (key-up at $keyUp, hidden: $hidden, cancellable: $cancellable, mute: $playbackMute)",
    ({ keyUp, hidden, cancellable, playbackMute }) => {
      loadSustainedChord();
      if (!cancellable) useUncancellableSampler(playbackMute);
      const base = { partIndex: scorePartCount, playbackLaneId: chordLaneId, channel: 0, midiNote: 0, velocity: 80 };
      engine.loadTimeline(
        {
          ...engine.getTimeline()!,
          events: [
            { ...base, type: "controlChange", time: 0, cc: 64, value: 127 },
            ...firstChord.map((midiNote): MidiEvent => ({ ...base, type: "noteOn", time: 0, midiNote })),
            ...firstChord.map((midiNote): MidiEvent => ({ ...base, type: "noteOff", time: keyUp, midiNote })),
            { ...base, type: "controlChange", time: 2, cc: 64, value: 0 },
          ],
        },
        samplers,
      );
      if (hidden) engine.setViewPartFilter(new Set());
      engine.play(1);
      engine.setTempo(90);
      if (hidden) {
        tick(0.1);
        engine.setViewPartFilter(new Set([scorePartCount]));
      }
      tick(0.125);
      tick(0.25);
      expectChord(firstChord);
      expect(worklet.channels[chordChannel]!.released).toEqual(new Set(firstChord));
      for (let time = 0.375; time < 1.6; time += 0.125) tick(time);
      tick(1.6);
      expectChord([]);
      for (const note of firstChord) expect(attacks(chordChannel, note)).toHaveLength(1);
    },
  );

  it.each([false, true])("does not replay chased attacks at the tempo boundary (queue drained: %s)", (drained) => {
    loadSustainedChord();
    engine.play(1);
    if (drained) worklet.advance(0.1875);
    else worklet.setClock(0.1875);
    engine.setTempo(90);
    tick(0.1875);
    tick(0.375);
    expectChord([...firstChord, ...secondChord]);
    for (const note of [...firstChord, ...secondChord]) expect(attacks(chordChannel, note)).toHaveLength(1);
  });

  it("does not duplicate chased attacks when the sampler cannot cancel its queue", () => {
    loadSustainedChord();
    samplers.set(chordLaneId, {
      noteOn: (note, velocity, time) => chordSampler.noteOn(note, velocity, time),
      noteOff: (note, time) => chordSampler.noteOff(note, time),
      allNotesOff: () => chordSampler.allNotesOff(),
      setVolume: (volume) => chordSampler.setVolume(volume),
      setPan: (pan) => chordSampler.setPan(pan),
    });
    if (facade) samplers.delete(scorePartCount);
    engine.play(1);
    engine.setTempo(90);
    tick(0.1875);
    tick(0.25);
    expectChord([...firstChord, ...secondChord]);
    for (const note of [...firstChord, ...secondChord]) {
      expect(attacks(chordChannel, note)).toEqual([{ channel: chordChannel, note, time: 0.1875 }]);
    }
  });

  it("routes chords and controls by string lane, independently of part index and MIDI channel", () => {
    expect(samplers.has(scorePartCount)).toBe(facade);
    engine.play();
    expectChord(firstChord);
    tick(0.125);
    tick(0.25);
    expect(worklet.channels[chordChannel]!.program).toBe(24);
    expect(worklet.channels[chordChannel]!.controllers.get(11)).toBe(70);
    expect(worklet.channels[0]!.program).toBe(40);
    tick(0.3125);
    tick(0.5);
    expectChord([...firstChord, ...secondChord]);
    tick(0.625);
    tick(0.75);
    expectChord(firstChord);
    tick(0.875);
    tick(1);
    expectChord([]);
    for (const note of [...firstChord, ...secondChord]) {
      expect(attacks(chordChannel, note)).toHaveLength(1);
    }
    expect(worklet.channels[0]!.voices).toEqual(new Set(scorePartCount > 0 ? [60] : []));
    expectMixer(0.4, -0.5);
    tick(1.375);
    tick(1.5);
    expect(worklet.channels[0]!.voices.size).toBe(0);
  });

  it.each(["stop", "pause"] as const)("cancels queued chords on %s, permits preview, and restarts once", (action) => {
    engine.play();
    tick(0.3125);
    worklet.advance(0.375);
    engine[action]();
    expectChord([]);
    expect(engine.getState()).toBe(action === "stop" ? "stopped" : "paused");
    expect(engine.getScoreTimeSeconds()).toBe(action === "stop" ? 0 : 0.375);
    chordMixer.noteOn(72, 90);
    tick(0.625);
    expectChord([72]);
    for (const note of secondChord) expect(attacks(chordChannel, note)).toHaveLength(0);
    chordMixer.noteOff(72);
    engine.play(0);
    expectChord(firstChord);
    expect(worklet.channels[chordChannel]!.program).toBe(0);
    expect(worklet.channels[chordChannel]!.controllers.get(11)).toBe(127);
    tick(0.9375);
    tick(1.125);
    expectChord([...firstChord, ...secondChord]);
    for (const note of firstChord) expect(attacks(chordChannel, note)).toHaveLength(2);
    for (const note of secondChord) expect(attacks(chordChannel, note)).toHaveLength(1);
    expectMixer(0.4, -0.5);
  });

  it("seeks past queued attacks, then chases the chord lane's state on a backward seek", () => {
    engine.play();
    tick(0.3125);
    worklet.advance(0.375);
    engine.seek(1.25);
    expectChord([]);
    tick(0.625);
    for (const note of secondChord) expect(attacks(chordChannel, note)).toHaveLength(0);
    engine.seek(0.375);
    expect(engine.getScoreTimeSeconds()).toBe(0.375);
    expect(worklet.channels[chordChannel]!.program).toBe(24);
    expect(worklet.channels[chordChannel]!.controllers.get(11)).toBe(70);
    expect(worklet.channels[0]!.program).toBe(40);
    tick(0.75);
    expectChord(secondChord);
    for (const note of secondChord) {
      expect(attacks(chordChannel, note)).toEqual([{ channel: chordChannel, note, time: 0.75 }]);
    }
    tick(0.875);
    tick(1);
    expectChord([]);
    expectMixer(0.4, -0.5);
  });

  it("restores held derived harmony on seek/resume and releases it at its authored end", () => {
    engine.loadTimeline({ ...timeline, chasePartIndices: [scorePartCount] }, samplers);
    engine.play(0.25);
    expectChord(firstChord);
    expect(worklet.channels[0]!.voices.size).toBe(0);
    engine.seek(0.625);
    expectChord([...firstChord, ...secondChord]);
    engine.pause();
    expectChord([]);
    engine.play();
    expectChord([...firstChord, ...secondChord]);
    tick(0.125);
    tick(0.25);
    expectChord(firstChord);
    tick(0.375);
    expectChord([]);
    engine.seek(0);
    expectChord(firstChord);
    expect(attacks(chordChannel, firstChord[0]!)).toHaveLength(4);
  });

  it("does not chase native-owned or selection-excluded harmony", () => {
    engine.loadTimeline({ ...timeline, chasePartIndices: [scorePartCount] }, samplers);
    engine.setViewPartFilter(new Set());
    engine.play(0.625);
    expectChord([]);
    engine.setViewPartFilter(new Set([scorePartCount]));
    expectChord([...firstChord, ...secondChord]);
    for (const note of [...firstChord, ...secondChord]) expect(attacks(chordChannel, note)).toHaveLength(1);
  });

  it.each([false, true])("restores held and queued chords exactly once (initially filtered: %s)", (initiallyHidden) => {
    const ordinaryOnly = new Set(Array.from({ length: scorePartCount }, (_, index) => index));
    if (initiallyHidden) engine.setViewPartFilter(ordinaryOnly);
    engine.play();
    tick(0.3125);
    worklet.advance(0.375);
    engine.setViewPartFilter(ordinaryOnly);
    expectChord([]);
    tick(0.625);
    for (const note of secondChord) expect(attacks(chordChannel, note)).toHaveLength(0);
    const playhead = vi.fn();
    engine.on("playhead", playhead);
    // The extra index must be explicitly includable, not treated as an array bound.
    engine.setViewPartFilter(new Set([...ordinaryOnly, scorePartCount]));
    expect(playhead).not.toHaveBeenCalled();
    expect(engine.getScoreTimeSeconds()).toBe(0.625);
    expectChord([...firstChord, ...secondChord]);
    expect(worklet.channels[chordChannel]!.program).toBe(24);
    expect(worklet.channels[chordChannel]!.controllers.get(11)).toBe(70);
    engine.setViewPartFilter(null);
    tick(0.625);
    for (const note of firstChord) expect(attacks(chordChannel, note)).toHaveLength(initiallyHidden ? 1 : 2);
    for (const note of secondChord) expect(attacks(chordChannel, note)).toHaveLength(1);
    expect(attacks(0, 60)).toHaveLength(scorePartCount > 0 ? 1 : 0);
    tick(0.75);
    expectChord(firstChord);
    tick(0.875);
    tick(1);
    expectChord([]);
    expectMixer(0.4, -0.5);
  });

  it("keeps mixer mute and pan independent of view filtering, seek, and restart", () => {
    engine.play();
    tick(0.3125);
    chordMixer.setVolume(0);
    chordMixer.setPan(0.75);
    worklet.advance(0.375);
    engine.setViewPartFilter(new Set());
    tick(0.625);
    engine.setViewPartFilter(null);
    expectMixer(0, 0.75);
    engine.seek(0.375);
    expectMixer(0, 0.75);
    engine.stop();
    engine.play();
    expectMixer(0, 0.75);
    chordMixer.setVolume(0.4);
    expectMixer(0.4, 0.75);
    const controls = worklet.channels[0]!.controllers;
    expect(controls.get(7)).toBe(Math.round(0.8 * 0x3fff) >> 7);
    expect(controls.get(10)).toBe(Math.round(1.5 * 63.5));
  });

  it("cancels the old string lane when reloading a timeline without chords", () => {
    engine.play();
    tick(0.3125);
    worklet.advance(0.375);
    const events = timeline.events.filter((event) => event.playbackLaneId !== chordLaneId);
    const remaining = new Map<number | string, ISampler>();
    if (scorePartCount > 0) remaining.set(scorePartCount - 1, ordinarySampler);
    engine.loadTimeline({ ...timeline, events }, remaining);
    expect(engine.getState()).toBe("stopped");
    expectChord([]);
    tick(0.625);
    for (const note of secondChord) expect(attacks(chordChannel, note)).toHaveLength(0);
    engine.play();
    expectChord([]);
    expect(worklet.channels[0]!.voices).toEqual(new Set(scorePartCount > 0 ? [60] : []));
  });
});

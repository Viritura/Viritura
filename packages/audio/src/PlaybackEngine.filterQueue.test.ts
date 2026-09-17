import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayeredSampler } from "./LayeredSampler";
import { PlaybackEngine } from "./PlaybackEngine";
import { SamplerGroup } from "./SamplerGroup";
import { Sf2Sampler } from "./Sf2Sampler";
import { createSamplerWorkletHarness } from "./sf2Scheduling/workletHarness.spec";
import type { ISampler, MidiEvent, MidiTimeline } from "./types";

describe.each(["parts", "lanes", "facades", "layers"] as const)("SF2 filter queue continuity (%s)", (routing) => {
  let engine: PlaybackEngine;
  let worklet: ReturnType<typeof createSamplerWorkletHarness>;
  let samplers: Map<number | string, ISampler>;
  let lanes: { partIndex: number; channel: number; sampler: ISampler; playbackLaneId?: string }[];
  let click: ReturnType<typeof vi.fn>;

  function tick(time: number) {
    worklet.advance(time);
    vi.advanceTimersByTime(25);
  }

  function channelsForPart(partIndex: number) {
    return lanes
      .filter((lane) => lane.partIndex === partIndex)
      .flatMap(({ channel }) => (routing === "layers" ? [channel, channel + 8] : [channel]));
  }

  function attacks(channel: number, note: number) {
    return worklet.attacks.filter((attack) => attack.channel === channel && attack.note === note);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    worklet = createSamplerWorkletHarness();
    worklet.setClock(0);
    samplers = new Map();
    lanes = [0, 1].flatMap((partIndex) =>
      Array.from({ length: routing === "parts" ? 1 : 4 }, (_, index) => {
        const channel = partIndex * 4 + index;
        const primary = new Sf2Sampler(worklet.sf2Synth, channel, 40 + index);
        const sampler =
          routing === "layers"
            ? new LayeredSampler(primary, [
                { sampler: new Sf2Sampler(worklet.sf2Synth, channel + 8, 48), volumeRatio: 0.5 },
              ])
            : primary;
        const playbackLaneId = routing === "parts" ? undefined : `${partIndex}:staff${index >> 1}:voice${index % 2}`;
        samplers.set(playbackLaneId ?? partIndex, sampler);
        return { partIndex, channel, sampler, playbackLaneId };
      }),
    );
    if (routing === "facades" || routing === "layers") {
      for (const partIndex of [0, 1]) {
        samplers.set(
          partIndex,
          new SamplerGroup(lanes.filter((lane) => lane.partIndex === partIndex).map((lane) => lane.sampler)),
        );
      }
    }
    const events = lanes.flatMap(({ partIndex, playbackLaneId, channel }): MidiEvent[] => {
      const base = { partIndex, playbackLaneId, channel, midiNote: 60, velocity: 80 };
      return [
        { ...base, type: "noteOn", time: 0 },
        { ...base, type: "controlChange", time: 0.1, cc: 11, value: 70 },
        { ...base, type: "noteOn", time: 0.6, midiNote: 62 },
        { ...base, type: "noteOff", time: 0.8, midiNote: 62 },
        { ...base, type: "noteOff", time: 1.4 },
      ];
    });
    const timeline: MidiTimeline = {
      events: events.sort((a, b) => a.time - b.time),
      duration: 2,
      tempoMap: [{ measureIndex: 0, beat: 0, time: 0, bpm: 120 }],
      measureStartTimes: [0],
    };
    engine = new PlaybackEngine(worklet.sf2Synth.context, { leadInTime: 0, scheduleAheadTime: 0.2 });
    engine.loadTimeline(timeline, samplers);
    click = vi.fn();
    engine.setClickTrack([{ time: 0.1, accented: true }]);
    engine.setClickCallback(click);
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it.each(
    [false, true].flatMap((initiallyHidden) =>
      [false, true].map((tickWhileHidden) => ({
        initiallyHidden,
        tickWhileHidden,
      })),
    ),
  )(
    "restores once after tempo change ($initiallyHidden hidden initially, $tickWhileHidden tick)",
    ({ initiallyHidden, tickWhileHidden }) => {
      if (initiallyHidden) engine.setViewPartFilter(new Set([0]));
      engine.play();
      tick(0.41);
      worklet.advance(0.45);
      engine.setViewPartFilter(new Set([0]));
      worklet.advance(0.46);
      engine.setTempo(240);
      if (tickWhileHidden) tick(0.5);
      worklet.advance(0.54);
      const playhead = vi.fn();
      engine.on("playhead", playhead);
      const controlsBefore = worklet.received.filter((event) => (event.data.messageData[0]! & 0xf0) === 0xb0).length;
      engine.setViewPartFilter(null);
      expect(engine.getScoreTimeSeconds()).toBeCloseTo(0.62);
      expect(playhead).not.toHaveBeenCalled();
      for (const channel of channelsForPart(1)) {
        expect(worklet.channels[channel]!.voices).toEqual(new Set([60, 62]));
        expect(attacks(channel, 62)).toEqual([{ channel, note: 62, time: 0.54 }]);
        expect(worklet.channels[channel]!.controllers.get(11)).toBe(70);
      }
      tick(0.54);
      worklet.advance(0.6);
      for (const channel of channelsForPart(1)) expect(attacks(channel, 62)).toHaveLength(1);
      expect(worklet.received.filter((event) => (event.data.messageData[0]! & 0xf0) === 0xb0)).toHaveLength(
        controlsBefore,
      );
      expect(click).toHaveBeenCalledExactlyOnceWith(0.1, true);
      expect(worklet.outputNode.gain.value).toBe(0.35);
      worklet.advance(0.64);
      for (const channel of channelsForPart(1)) expect(worklet.channels[channel]!.voices).toEqual(new Set([60]));
    },
  );

  it.each([240, 60])("recovers future queued attacks only at the new onset at %s BPM", (bpm) => {
    engine.play();
    tick(0.41);
    worklet.advance(0.45);
    engine.setViewPartFilter(new Set([0]));
    worklet.advance(0.46);
    engine.setTempo(bpm);
    worklet.advance(0.48);
    engine.setViewPartFilter(null);
    tick(0.48);
    const onset = 0.46 + (0.6 - 0.46) / (bpm / 120);
    if (bpm === 60) tick(0.57);
    worklet.advance(onset - 0.001);
    for (const channel of channelsForPart(1)) expect(attacks(channel, 62)).toHaveLength(0);
    worklet.advance(onset);
    for (const channel of channelsForPart(1))
      expect(attacks(channel, 62)).toEqual([{ channel, note: 62, time: onset }]);
    worklet.advance(Math.max(0.6, onset));
    for (const channel of channelsForPart(1)) expect(attacks(channel, 62)).toHaveLength(1);
  });

  it.each([false, true])("restores at the onset quantum once (queue already drained: %s)", (drained) => {
    engine.play();
    tick(0.41);
    worklet.advance(0.45);
    engine.setViewPartFilter(new Set([0]));
    if (drained) worklet.advance(0.6);
    else worklet.setClock(0.6);
    engine.setViewPartFilter(null);
    worklet.advance(0.6);
    tick(0.6);
    for (const channel of channelsForPart(1)) {
      expect(attacks(channel, 62)).toEqual([{ channel, note: 62, time: 0.6 }]);
      expect(worklet.channels[channel]!.voices).toEqual(new Set([60, 62]));
    }
    tick(0.8);
    for (const channel of channelsForPart(1)) expect(worklet.channels[channel]!.voices).toEqual(new Set([60]));
  });

  it.each([false, true])("does not replay an onset on a tempo boundary (queue already drained: %s)", (drained) => {
    engine.play();
    tick(0.41);
    if (drained) worklet.advance(0.6);
    else worklet.setClock(0.6);
    engine.setTempo(240);
    tick(0.6);
    for (const channel of [...channelsForPart(0), ...channelsForPart(1)]) {
      expect(attacks(channel, 62)).toEqual([{ channel, note: 62, time: 0.6 }]);
    }
  });

  it.each([false, true])(
    "restores pedal-sustained voices after tempo edits (tick while hidden: %s)",
    (tickWhileHidden) => {
      const timeline = engine.getTimeline()!;
      engine.loadTimeline(
        {
          ...timeline,
          events: timeline.events.map((event) => {
            if (event.type === "controlChange") return { ...event, cc: 64, value: 127 };
            if (event.time === 0.8) return { ...event, time: 0.61 };
            if (event.time === 1.4) return { ...event, type: "controlChange", cc: 64, value: 0 };
            return event;
          }),
        },
        samplers,
      );
      engine.play();
      tick(0.42);
      worklet.advance(0.45);
      engine.setViewPartFilter(new Set([0]));
      worklet.advance(0.46);
      engine.setTempo(240);
      if (tickWhileHidden) tick(0.5);
      worklet.advance(0.54);
      engine.setViewPartFilter(null);
      tick(0.54);
      worklet.advance(0.62);
      for (const channel of channelsForPart(1)) {
        expect(attacks(channel, 62)).toEqual([{ channel, note: 62, time: 0.54 }]);
        expect(worklet.channels[channel]!.voices.has(62)).toBe(true);
        expect(worklet.channels[channel]!.released.has(62)).toBe(true);
      }
      tick(0.8);
      worklet.advance(0.94);
      for (const channel of channelsForPart(1)) expect(worklet.channels[channel]!.voices.has(62)).toBe(false);
    },
  );

  it.each(["pause", "stop"] as const)("allows previews after filtered %s without queued playback leaks", (action) => {
    engine.play();
    tick(0.41);
    worklet.advance(0.45);
    engine.setViewPartFilter(new Set([0]));
    engine[action]();
    const position = engine.getScoreTimeSeconds();
    engine.setViewPartFilter(null);
    // Preview uses the same part facade as the editor, not a new sampler.
    const preview = samplers.get(1) ?? lanes.find((lane) => lane.partIndex === 1)!.sampler;
    preview.noteOn(72, 90);
    expect(worklet.channels[4]!.voices).toEqual(new Set([72]));
    for (const time of [0.5, 0.55, 0.6, 0.61, 0.75, 0.8, 0.95, 1.1]) {
      tick(time);
      for (const channel of [...channelsForPart(0), ...channelsForPart(1)]) {
        expect(attacks(channel, 62)).toHaveLength(0);
        expect(worklet.channels[channel]!.voices.has(60)).toBe(false);
      }
      expect(worklet.channels[4]!.voices).toEqual(new Set([72]));
    }
    expect(engine.getScoreTimeSeconds()).toBe(position);
    preview.noteOff(72);
    expect(worklet.channels[4]!.voices.size).toBe(0);
  });
});

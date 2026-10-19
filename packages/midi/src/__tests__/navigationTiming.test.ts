import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { generateTimeline, generatePerformanceEvents } from "../index";

function navigationScore(): Score {
  const note = (measure: number, beat: number): NoteEvent => ({
    id: `e${measure}-${beat}`,
    type: "event",
    duration: { base: "quarter" },
    notes: [{ id: `n${measure}-${beat}`, pitch: { step: "C", octave: 4 } }],
  });
  const score: Score = {
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] },
        { segno: { location: { fraction: [1, 4] } } },
        { fine: { location: { fraction: [1, 2] } } },
        {},
      ],
    },
    parts: [
      {
        id: "p",
        name: "Part",
        measures: Array.from({ length: 4 }, (_, measure) => ({
          sequences: [{ content: Array.from({ length: 4 }, (_, beat) => note(measure, beat)) }],
        })),
      },
    ],
  };
  Reflect.set(score.global.measures[3]!, "jump", {
    type: "dsAlFine",
    location: { fraction: [3, 4] },
  });
  return score;
}

describe("location-aware navigation timing", () => {
  it("reattacks a tied destination when its source is outside the performed span", () => {
    const score = navigationScore();
    const content = score.parts[0]!.measures[1]!.sequences[0]!.content;
    const source = content[0] as NoteEvent;
    source.notes![0]!.ties = [{ target: "n1-1" }];
    const timeline = generateTimeline(score);
    const reattack = timeline.events.filter((event) => event.type === "noteOn" && event.scoreEventId === "e1-1");
    expect(reattack).toHaveLength(1);
    expect(reattack[0]!.time).toBeCloseTo(7.5, 1);
    const native = generatePerformanceEvents(score, 0).filter(
      (event) => event.kind === "noteOn" && event.note.id === "n1-1",
    );
    expect(native).toHaveLength(1);
    expect(native[0]!.time).toBeCloseTo(7.5);
  });

  it("does not apply relative dynamics in skipped measure prefixes or suffixes", () => {
    const score = navigationScore();
    score.parts[0]!.measures[1]!.dynamics = [
      { id: "played-once", type: "relative", relativeValue: "louder", position: { fraction: [1, 8] } },
    ];
    score.parts[0]!.measures[3]!.dynamics = [
      { id: "never-played", type: "relative", relativeValue: "louder", position: { fraction: [7, 8] } },
    ];
    const onsets = generateTimeline(score).events.filter((event) => event.type === "noteOn");
    const beforeJump = onsets.find((event) => event.scoreEventId === "e1-1")!;
    const replay = onsets.filter((event) => event.scoreEventId === "e1-1")[1]!;
    expect(replay.velocity).toBe(beforeJump.velocity);
    const native = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const previous = native.find((event) => event.note.id === "n3-2")!;
    const repeated = native.filter((event) => event.note.id === "n1-1")[1]!;
    expect(repeated.note.dynamics).toBe(previous.note.dynamics);
  });

  it("does not carry techniques from unperformed material into the replay", () => {
    const score = navigationScore();
    score.parts[0]!.measures[1]!.expressions = [{ position: { fraction: [1, 8] }, text: [{ text: "pizz." }] }];
    score.parts[0]!.measures[2]!.expressions = [{ position: { fraction: [0, 1] }, text: [{ text: "arco" }] }];
    score.parts[0]!.measures[3]!.expressions = [{ position: { fraction: [7, 8] }, text: [{ text: "pizz." }] }];
    const notes = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    const initial = notes.filter((event) => event.note.id === "n1-1")[0]!;
    const repeated = notes.filter((event) => event.note.id === "n1-1")[1]!;
    expect(initial.note.state.pizzicato).toBe(true);
    expect(repeated.note.state.pizzicato).toBe(false);
  });

  it("clips a sounding note at a mid-measure jump instead of leaking into replay", () => {
    const score = navigationScore();
    score.parts[0]!.measures[3]!.sequences[0]!.content = [
      {
        id: "long",
        type: "event",
        duration: { base: "whole" },
        notes: [{ id: "long-note", pitch: { step: "G", octave: 4 } }],
      },
    ];
    const timeline = generateTimeline(score);
    const onset = timeline.events.find((event) => event.type === "noteOn" && event.scoreEventId === "long");
    expect(onset).toBeDefined();
    const release = timeline.events.find(
      (event) => event.type === "noteOff" && event.midiNote === onset!.midiNote && event.time > onset!.time,
    );
    expect(release?.time).toBeCloseTo(7.5);
    const native = generatePerformanceEvents(score, 0).find(
      (event) => event.kind === "noteOn" && event.note.id === "long-note",
    );
    expect(native?.kind === "noteOn" && native.note.duration).toBeCloseTo(1.5);
  });

  it("restores destination tempo after replaying an earlier score position", () => {
    const score = navigationScore();
    score.global.measures[2]!.tempos = [{ bpm: 60, value: { base: "quarter" } }];
    const timeline = generateTimeline(score);
    expect(timeline.duration).toBeCloseTo(14.5);
    const replayStart = timeline.measureStartBeats[4]!;
    expect(timeline.model.bpmAtBeat(replayStart)).toBe(120);
    expect(timeline.model.bpmAtBeat(timeline.measureStartBeats[5]!)).toBe(60);
  });

  it("plays only the selected measure spans with consistent MIDI and performance duration", () => {
    const score = navigationScore();
    const timeline = generateTimeline(score);
    expect(timeline.totalBeats).toBe(20);
    expect(timeline.duration).toBeCloseTo(10);
    expect(timeline.playedSpans?.map((span) => [span.measureIndex, span.startBeat, span.endBeat])).toEqual([
      [0, 0, 4],
      [1, 0, 4],
      [2, 0, 4],
      [3, 0, 3],
      [1, 1, 4],
      [2, 0, 2],
    ]);
    const onsets = timeline.events.filter((event) => event.type === "noteOn");
    expect(onsets).toHaveLength(20);
    expect(onsets.map((event) => event.scoreEventId)).toEqual([
      "e0-0",
      "e0-1",
      "e0-2",
      "e0-3",
      "e1-0",
      "e1-1",
      "e1-2",
      "e1-3",
      "e2-0",
      "e2-1",
      "e2-2",
      "e2-3",
      "e3-0",
      "e3-1",
      "e3-2",
      "e1-1",
      "e1-2",
      "e1-3",
      "e2-0",
      "e2-1",
    ]);
    const performance = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
    expect(performance).toHaveLength(20);
    performance.forEach((event, index) => {
      expect(event.time).toBeCloseTo(onsets[index]!.scoreBeat! * 0.5, 2);
    });
    expect(timeline.events.every((event) => event.time <= timeline.duration)).toBe(true);
  });

  it("plays once in score order when navigation is disabled", () => {
    const timeline = generateTimeline(navigationScore(), { expandRepeats: false });
    expect(timeline.totalBeats).toBe(16);
    expect(
      generatePerformanceEvents(navigationScore(), 0, { expandRepeats: false }).filter(
        (event) => event.kind === "noteOn",
      ),
    ).toHaveLength(16);
  });
});

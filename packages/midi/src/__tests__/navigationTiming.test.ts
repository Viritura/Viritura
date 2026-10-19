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

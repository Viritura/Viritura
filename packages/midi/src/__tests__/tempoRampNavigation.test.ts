import { describe, expect, it } from "vitest";
import type { Score, TempoRampCurve } from "@viritura/core";
import { generateTimeline, generatePerformanceEvents } from "../index";
import { buildTempoModel } from "../tempoMap";

function source(curve: TempoRampCurve): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "m0",
          time: { count: 4, unit: 4 },
          repeatStart: {},
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          gradualTempo: {
            position: { fraction: [0, 1] },
            end: { measure: "m2", position: { fraction: [1, 1] } },
            endRatio: 0.5,
            curve,
          },
        },
        { id: "m1", repeatEnd: {} },
        { id: "m2" },
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: [0, 1, 2].map((measure) => ({
          sequences: [
            {
              content: [0, 1, 2, 3].map((beat) => ({
                type: "event" as const,
                id: `e${measure}-${beat}`,
                duration: { base: "quarter" as const },
                notes: [{ id: `n${measure}-${beat}`, pitch: { step: "C" as const, octave: 4 as const } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}

describe("native tempo ramps follow the playback itinerary", () => {
  it.each(["linear", "early", "late", "smooth"] as const)(
    "realizes a %s ramp crossing a real repeat without overlapping declarations",
    (curve) => {
      const score = source(curve);
      const canonical = buildTempoModel(score.global.measures);
      const timeline = generateTimeline(score);
      expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 1, 2]);
      const starts = [0, 4, 0, 4, 8];
      let expectedTime = 0;
      starts.forEach((start, index) => {
        expect(timeline.measureStartTimes[index]).toBeCloseTo(expectedTime, 6);
        for (const offset of [0, 0.25, 2, 3.75]) {
          expect(timeline.model.bpmAtBeat(index * 4 + offset)).toBeCloseTo(
            canonical.model.bpmAtBeat(start + offset),
            6,
          );
        }
        expectedTime += canonical.model.secondsForBeats(start, 4);
      });
      expect(timeline.duration).toBeCloseTo(expectedTime, 6);
      expect(timeline.model.bpmAtBeat(20)).toBeCloseTo(60, 6);
      const nativeOnsets = generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn");
      expect(nativeOnsets).toHaveLength(20);
      nativeOnsets.forEach((event, index) => {
        expect(event.time).toBeCloseTo(timeline.model.timeAtBeat(index), 6);
      });
      expect(score.global.measures[0]!.gradualTempo?.end.measure).toBe("m2");
    },
  );

  it("can finish a ramp in a first ending that is skipped on the second pass", () => {
    const score = source("smooth");
    score.global.measures[1]!.ending = { numbers: [1], duration: 1 };
    score.global.measures[0]!.gradualTempo!.end = { measure: "m1", position: { fraction: [1, 1] } };
    const canonical = buildTempoModel(score.global.measures).model;
    const timeline = generateTimeline(score);
    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 2]);
    expect(timeline.model.bpmAtBeat(10)).toBeCloseTo(canonical.bpmAtBeat(2), 6);
    expect(timeline.model.bpmAtBeat(12)).toBeCloseTo(60, 6);
    expect(generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn")).toHaveLength(16);
  });

  it("realizes sub-bar jumps by slicing the source ramp without changing its curve", () => {
    const score = source("late");
    delete score.global.measures[0]!.repeatStart;
    delete score.global.measures[1]!.repeatEnd;
    score.global.measures[0]!.segno = { location: { fraction: [1, 4] } };
    score.global.measures[1]!.jump = { type: "segno", location: { fraction: [1, 2] } };
    const canonical = buildTempoModel(score.global.measures).model;
    const timeline = generateTimeline(score);
    expect(timeline.playedSpans?.map((span) => [span.measureIndex, span.startBeat, span.endBeat])).toEqual([
      [0, 0, 4],
      [1, 0, 2],
      [0, 1, 4],
      [1, 0, 4],
      [2, 0, 4],
    ]);
    expect(timeline.model.bpmAtBeat(6)).toBeCloseTo(canonical.bpmAtBeat(1), 6);
    expect(timeline.model.bpmAtBeat(8)).toBeCloseTo(canonical.bpmAtBeat(3), 6);
    expect(generatePerformanceEvents(score, 0).filter((event) => event.kind === "noteOn")).toHaveLength(17);
  });

  it("keeps per-occurrence fermata holds aligned with the realized ramp tempo", () => {
    const score = source("early");
    const event = score.parts[0]!.measures[1]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("Expected note fixture");
    event.fermata = {};
    const timeline = generateTimeline(score);
    const nativeOnsets = generatePerformanceEvents(score, 0).filter((item) => item.kind === "noteOn");
    nativeOnsets.forEach((onset, beat) => expect(onset.time).toBeCloseTo(timeline.model.timeAtBeat(beat), 6));
    const without = source("early");
    expect(timeline.duration).toBeGreaterThan(generateTimeline(without).duration);
  });
});

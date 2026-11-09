import { describe, expect, it } from "vitest";
import type { GlobalMeasure, TempoRampCurve } from "@viritura/core";
import { buildTempoMap, buildTempoModel } from "../tempoMap";
import { generateTimeline } from "../timeline";
import { timingHumanize } from "../dynamics";

function measures(curve: TempoRampCurve = "linear"): GlobalMeasure[] {
  return [
    {
      id: "m0",
      time: { count: 4, unit: 4 },
      tempos: [{ bpm: 120, value: { base: "quarter" } }],
      gradualTempo: {
        position: { fraction: [0, 1] },
        end: { measure: "m1", position: { fraction: [0, 1] } },
        endRatio: 0.5,
        curve,
      },
    },
    { id: "m1" },
    { id: "m2" },
  ];
}

describe("native tempo ramp targets and curves", () => {
  it.each([
    ["linear", 90],
    ["early", 75],
    ["late", 105],
    ["smooth", 90],
  ] as const)("plays %s with the expected midpoint and holds the target", (curve, midpoint) => {
    const { model } = buildTempoModel(measures(curve));
    expect(model.bpmAtBeat(0)).toBeCloseTo(120, 6);
    expect(model.bpmAtBeat(2)).toBeCloseTo(midpoint, 3);
    expect(model.bpmAtBeat(4)).toBeCloseTo(60, 6);
    expect(model.bpmAtBeat(10)).toBeCloseTo(60, 6);
  });

  it.each(["linear", "early", "late", "smooth"] as const)(
    "%s integrates within 0.1 ms of independent numerical integration and round-trips",
    (curve) => {
      const { model } = buildTempoModel(measures(curve));
      const shape = (u: number) => {
        switch (curve) {
          case "linear":
            return u;
          case "early":
            return 1 - (1 - u) ** 2;
          case "late":
            return u * u;
          case "smooth":
            return u * u * (3 - 2 * u);
        }
      };
      const n = 20_000;
      let expected = 0;
      for (let i = 0; i < n; i++) expected += ((4 / n) * 60) / (120 - 60 * shape((i + 0.5) / n));
      expect(Math.abs(model.timeAtBeat(4) - expected)).toBeLessThan(0.0001);
      for (const beat of [0, 0.1, 0.75, 2, 3.999, 4, 8]) {
        expect(model.beatAtTime(model.timeAtBeat(beat))).toBeCloseTo(beat, 7);
      }
    },
  );

  it("uses the previous ramp's held target as the next ratio's starting tempo", () => {
    const score = measures();
    score[1]!.gradualTempo = {
      position: { fraction: [0, 1] },
      end: { measure: "m2", position: { fraction: [0, 1] } },
      endRatio: 1.5,
    };
    const { model } = buildTempoModel(score);
    expect(model.bpmAtBeat(4)).toBeCloseTo(60);
    expect(model.bpmAtBeat(6)).toBeCloseTo(75);
    expect(model.bpmAtBeat(8)).toBeCloseTo(90);
  });

  it("keeps explicit tempo-anchor timestamps aligned with the ramp's continuous clock", () => {
    const score = measures("smooth");
    score[2]!.tempos = [{ bpm: 150, value: { base: "quarter" } }];
    const timing = buildTempoModel(score);
    const legacy = buildTempoMap(score);
    expect(legacy.measureStartTimes).toEqual(timing.measureStartTimes);
    expect(legacy.tempoMap.at(-1)?.timeSeconds).toBeCloseTo(timing.model.timeAtBeat(8), 7);
    expect(legacy.tempoMap.at(-1)?.bpm).toBe(150);
  });

  it("resolves ratios in normalized quarter-note BPM, not the printed beat unit", () => {
    const score = measures();
    score[0]!.tempos = [{ bpm: 80, value: { base: "quarter", dots: 1 } }];
    expect(buildTempoModel(score).model.bpmAtBeat(4)).toBeCloseTo(60);
    score[0]!.tempos = [{ bpm: 100, value: { base: "quarter", dots: 1 } }];
    expect(buildTempoModel(score).model.bpmAtBeat(4)).toBeCloseTo(75);
  });

  it.each(["linear", "early", "late", "smooth"] as const)(
    "interrupts %s at an explicit tempo without compressing the curve or restoring its discarded target",
    (curve) => {
      const original = measures(curve);
      const before = buildTempoModel(original).model;
      original[0]!.tempos!.push({ bpm: 150, value: { base: "quarter" }, location: { fraction: [1, 2] } });
      const { model } = buildTempoModel(original);
      expect(model.bpmAtBeat(1)).toBeCloseTo(before.bpmAtBeat(1), 3);
      expect(model.bpmAtBeat(2)).toBeCloseTo(150);
      expect(model.bpmAtBeat(4)).toBeCloseTo(150);
      expect(model.bpmAtBeat(10)).toBeCloseTo(150);
    },
  );

  it("retains text-only and swing-only instructions without interrupting ramps", () => {
    const score = measures("smooth");
    score[0]!.tempos!.push(
      { text: [{ text: "keep moving" }], location: { fraction: [1, 4] } },
      { swing: { mode: "straight" }, location: { fraction: [1, 2] } },
    );
    expect(buildTempoModel(score).model.bpmAtBeat(2)).toBeCloseTo(90, 3);
  });

  it("resolves endpoints within each expanded repeat occurrence", () => {
    const source = measures("late").slice(0, 2);
    const { model } = buildTempoModel([...source, ...structuredClone(source)]);
    expect(model.bpmAtBeat(0)).toBeCloseTo(120);
    expect(model.bpmAtBeat(4)).toBeCloseTo(60);
    expect(model.bpmAtBeat(8)).toBeCloseTo(120);
    expect(model.bpmAtBeat(12)).toBeCloseTo(60);
  });

  it("rejects overlapping ramps and invalid endpoints explicitly", () => {
    const score = measures();
    score[0]!.gradualTempo!.end.position.fraction = [1, 2];
    score[1]!.gradualTempo = {
      position: { fraction: [0, 1] },
      end: { measure: "m2", position: { fraction: [0, 1] } },
      endBpm: 180,
    };
    expect(() => buildTempoModel(score)).toThrow("overlap");
    delete score[1]!.gradualTempo;
    score[0]!.gradualTempo!.end.measure = "missing";
    expect(() => buildTempoModel(score)).toThrow("endpoint measure");
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid ratio %s", (endRatio) => {
    const score = measures();
    score[0]!.gradualTempo = { ...score[0]!.gradualTempo!, endBpm: undefined, endRatio };
    expect(() => buildTempoModel(score)).toThrow("greater than zero");
  });

  it("uses ramps for scheduled notes, not just tempo previews", () => {
    const timeline = generateTimeline({
      mnx: { version: 1 },
      global: { measures: measures("late") },
      parts: [
        {
          measures: [0, 1, 2].map((index) => ({
            sequences: [
              {
                content: [
                  {
                    type: "event" as const,
                    id: `e${index}`,
                    duration: { base: "whole" as const },
                    notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                  },
                ],
              },
            ],
          })),
        },
      ],
    });
    const expected = buildTempoModel(measures("late")).measureStartTimes[1]!;
    expect(timeline.measureStartTimes[1]).toBeCloseTo(expected, 7);
    const note = timeline.events.find((event) => event.type === "noteOn" && event.scoreEventId === "e1");
    expect(note?.time).toBeCloseTo(expected + timingHumanize(expected, 0, 0), 7);
  });
});

import { describe, it, expect } from "vitest";
import type { Score } from "../model/score";
import type { GlobalMeasure } from "../model/measure";
import type { Part } from "../model/part";

describe("Score", () => {
  it("should create a minimal Score object", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [] },
      parts: [],
    };

    expect(score.mnx.version).toBe(1);
    expect(score.global.measures).toEqual([]);
    expect(score.parts).toEqual([]);
  });

  it("should create a Score with one measure and one part", () => {
    const measure: GlobalMeasure = {
      time: { count: 4, unit: 4 },
      barline: { type: "regular" },
    };

    const part: Part = {
      name: "Piano",
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  duration: { base: "whole" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    };

    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [measure] },
      parts: [part],
    };

    expect(score.global.measures).toHaveLength(1);
    expect(score.global.measures[0]?.time?.count).toBe(4);
    expect(score.global.measures[0]?.time?.unit).toBe(4);
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0]?.name).toBe("Piano");
    const event = score.parts[0]?.measures[0]?.sequences[0]?.content[0];
    expect(event?.type).toBe("event");
    if (event?.type === "event") {
      expect(event.duration.base).toBe("whole");
    }
  });

  it("should support optional fields on GlobalMeasure", () => {
    const measure: GlobalMeasure = {};
    expect(measure.time).toBeUndefined();
    expect(measure.key).toBeUndefined();
    expect(measure.barline).toBeUndefined();
    expect(measure.repeatStart).toBeUndefined();
    expect(measure.repeatEnd).toBeUndefined();
  });

  it("should support key signature on GlobalMeasure", () => {
    const measure: GlobalMeasure = {
      key: { fifths: -3 },
    };
    expect(measure.key?.fifths).toBe(-3);
  });

  it("should support Part with shortName", () => {
    const part: Part = {
      name: "Violin I",
      shortName: "Vln. I",
      measures: [],
    };
    expect(part.name).toBe("Violin I");
    expect(part.shortName).toBe("Vln. I");
  });
});

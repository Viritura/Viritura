import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { createPickupBar, parsePickupDuration } from "../commands/pickupBar";
import { parseTimeSignatureInputWithError } from "../components/palette/timeSignatureInput";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          id: "opening",
          number: 7,
          time: { count: 4, unit: 4 },
          key: { fifths: 2 },
          tempos: [{ bpm: 96, value: { base: "quarter" } }],
        },
        { number: 8 },
      ],
    },
    parts: [
      {
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [{ content: [{ type: "event", id: "whole", duration: { base: "whole" }, rest: {} }] }],
          },
          { sequences: [{ content: [{ type: "event", id: "next", duration: { base: "whole" }, rest: {} }] }] },
        ],
      },
    ],
  };
}

describe("createPickupBar", () => {
  it("inserts a short unnumbered bar and moves opening context", () => {
    const result = createPickupBar(score(), { numerator: 1, denominator: 4 });

    expect(result.error).toBeNull();
    expect(result.score?.global.measures).toHaveLength(3);
    expect(result.score?.global.measures[0]).toMatchObject({
      number: 0,
      time: { count: 4, unit: 4 },
      key: { fifths: 2 },
      tempos: [{ bpm: 96 }],
    });
    expect(result.score?.global.measures[1]).toMatchObject({ id: "opening", number: 1 });
    expect(result.score?.global.measures[1]?.time).toBeUndefined();
    expect(result.score?.parts[0]?.measures[0]?.clefs).toHaveLength(1);
    expect(result.score?.parts[0]?.measures[1]?.clefs).toBeUndefined();
    expect(result.score?.parts[0]?.measures[0]?.sequences[0]?.content).toHaveLength(1);
  });

  it("moves opening global harmony into the pickup without creating part-local chords", () => {
    const source = score();
    source.global.measures[0]!.chordSymbols = [{ position: { fraction: [0, 1] }, root: { step: "C" } }];
    const original = structuredClone(source);

    const result = createPickupBar(source, { numerator: 1, denominator: 4 });

    expect(result.error).toBeNull();
    expect(result.score?.global.measures[0]?.chordSymbols).toEqual(source.global.measures[0]!.chordSymbols);
    expect(result.score?.global.measures[1]?.chordSymbols).toBeUndefined();
    expect(result.score?.parts[0]?.measures[0]).not.toHaveProperty("chordSymbols");
    expect(result.score?.parts[0]?.measures[1]).not.toHaveProperty("chordSymbols");
    expect(source).toEqual(original);
  });

  it("rejects full or duplicate pickups", () => {
    expect(createPickupBar(score(), { numerator: 1, denominator: 1 }).error).toContain("shorter");
    const existing = score();
    existing.global.measures[0]!.number = 0;
    expect(createPickupBar(existing, { numerator: 1, denominator: 4 }).error).toContain("already");
  });
});

describe("pickup duration syntax", () => {
  it("parses an explicit opening meter and pickup duration", () => {
    expect(parseTimeSignatureInputWithError("4/4, 1/4")).toMatchObject({
      time: { count: 4, unit: 4 },
      pickupDuration: { numerator: 1, denominator: 4 },
      error: null,
    });
    expect(parsePickupDuration("0/4")).toBeNull();
  });
});

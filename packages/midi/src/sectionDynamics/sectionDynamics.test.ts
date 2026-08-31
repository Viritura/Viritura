import { describe, expect, it } from "vitest";
import type { DynamicValue, Score } from "@viritura/core";
import { analyzeImpliedSectionDynamics } from ".";
import { generateTimeline } from "../timeline";
import { DYNAMIC_AXES } from "../dynamicsEnvelope";

function event(id: string, rest = false) {
  return rest
    ? { type: "event" as const, id, duration: { base: "whole" as const }, rest: {} }
    : {
        type: "event" as const,
        id,
        duration: { base: "whole" as const },
        notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
      };
}

function dynamic(id: string, value: DynamicValue) {
  return { id, type: "immediate" as const, position: { fraction: [0, 1] as [number, number] }, value };
}

function scoreWithGroup(values: {
  first: (DynamicValue | undefined)[];
  second: (DynamicValue | undefined)[];
  firstRests?: boolean[];
  secondRests?: boolean[];
}): Score {
  const measures = Math.max(values.first.length, values.second.length);
  const part = (id: string, dynamics: (DynamicValue | undefined)[], rests: boolean[] | undefined) => ({
    id,
    name: id,
    measures: Array.from({ length: measures }, (_, measureIndex) => ({
      sequences: [{ content: [event(`${id}-${measureIndex}`, rests?.[measureIndex])] }],
      ...(dynamics[measureIndex]
        ? { dynamics: [dynamic(`${id}-dynamic-${measureIndex}`, dynamics[measureIndex]!)] }
        : {}),
    })),
  });
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: measures }, (_, index) => ({
        id: `measure-${index}`,
        time: { count: 4, unit: 4 },
      })),
    },
    parts: [part("oboe-1", values.first, values.firstRests), part("oboe-2", values.second, values.secondRests)],
    layouts: [
      {
        id: "full",
        content: [
          { type: "staff", sources: [{ part: "oboe-1" }] },
          { type: "staff", sources: [{ part: "oboe-2" }] },
        ],
      },
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "oboe-1" }, { part: "oboe-2" }] }],
      },
    ],
    scores: [
      { name: "Uncondensed", layout: "full" },
      { name: "Oboe 2", layout: "full" },
    ],
  };
}

describe("section dynamics inference", () => {
  it("gives a resting player the section dynamic when it rejoins merged music", () => {
    const score = scoreWithGroup({
      first: ["f", "p", undefined, undefined],
      second: ["f", undefined, undefined, undefined],
      firstRests: [false, false, true, false],
      secondRests: [false, true, true, false],
    });

    const analyzed = analyzeImpliedSectionDynamics(score);
    expect(analyzed.get(1)).toContainEqual(expect.objectContaining({ value: "p", position: [0, 1] }));
    expect(score.parts[1]!.measures[3]!.dynamics).toBeUndefined();
  });

  it("does not guess when active players explicitly conflict", () => {
    const score = scoreWithGroup({
      first: ["p"],
      second: ["f"],
    });
    expect(analyzeImpliedSectionDynamics(score).size).toBe(0);
  });

  it("derives groups even when no condensed score is selected or exposed as the default", () => {
    const score = scoreWithGroup({
      first: ["p", undefined],
      second: [undefined, undefined],
      secondRests: [true, false],
    });
    score.scores = [{ name: "Oboe 2", layout: "full" }];

    expect(analyzeImpliedSectionDynamics(score).get(1)?.[0]?.value).toBe("p");
  });

  it("supports groups with more than two sources", () => {
    const score = scoreWithGroup({
      first: ["p", undefined],
      second: [undefined, undefined],
      secondRests: [true, false],
    });
    const third = structuredClone(score.parts[1]!);
    third.id = "oboe-3";
    third.name = "oboe-3";
    score.parts.push(third);
    score.layouts![1]!.content = [
      { type: "staff", sources: [{ part: "oboe-1" }, { part: "oboe-2" }, { part: "oboe-3" }] },
    ];

    const analyzed = analyzeImpliedSectionDynamics(score);
    expect(analyzed.get(1)?.[0]?.value).toBe("p");
    expect(analyzed.get(2)?.[0]?.value).toBe("p");
  });

  it("feeds inferred anchors into the generated playback dynamics lane", () => {
    const score = scoreWithGroup({
      first: ["f", "p", undefined, undefined],
      second: ["f", undefined, undefined, undefined],
      firstRests: [false, false, true, false],
      secondRests: [false, true, true, false],
    });
    const timeline = generateTimeline(score);
    const reentryTime = timeline.measureStartTimes[3]!;
    const expression = timeline.events.find(
      (event) =>
        event.type === "controlChange" &&
        event.partIndex === 1 &&
        event.cc === 11 &&
        Math.abs(event.time - reentryTime) < 1e-6,
    );

    expect(expression?.value).toBe(DYNAMIC_AXES.p!.cc11);
  });

  it("places an inferred anchor at a shared mid-measure reentry", () => {
    const score = scoreWithGroup({
      first: ["p", undefined],
      second: [undefined, undefined],
      secondRests: [true, false],
    });
    const reentryContent = [
      { type: "event" as const, duration: { base: "quarter" as const }, rest: {} },
      {
        type: "event" as const,
        duration: { base: "half" as const },
        notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
      },
      { type: "event" as const, duration: { base: "quarter" as const }, rest: {} },
    ];
    score.parts[0]!.measures[1]!.sequences[0]!.content = structuredClone(reentryContent);
    score.parts[1]!.measures[1]!.sequences[0]!.content = structuredClone(reentryContent);

    expect(analyzeImpliedSectionDynamics(score).get(1)?.[0]?.position).toEqual([1, 4]);
  });
});

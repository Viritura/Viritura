import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { applyBreathFermata } from "../radialMenu/radialMenuActions";
import type { BreathFermataSelection } from "../radialMenu/breathFermataMenu";
import { projectGlobalFermata } from "@viritura/core";
import { globalFermataId } from "../score/ElementPath";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev-1",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("applyBreathFermata — breath marks", () => {
  it("applies breath comma to an event", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "comma" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(ev.type).toBe("event");
    if (ev.type === "event") {
      expect(ev.markings?.breath).toEqual({});
    }
  });

  it("applies breath tick to an event", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "tick" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings?.breath).toEqual({ symbol: "tick" });
    }
  });

  it("does not mutate the original score", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "comma" };
    applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings).toBeUndefined();
    }
  });
});

describe("applyBreathFermata — fermata", () => {
  it("creates a global fermata at the selected onset without local notation", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "fermata", shape: "normal" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.fermata).toBeUndefined();
    }
    expect(result!.global.measures[0]!.fermatas).toEqual([{ id: expect.any(String), position: { fraction: [0, 1] } }]);
    expect(score.global.measures[0]!.fermatas).toBeUndefined();
  });

  it.each([
    ["doubleAngled", "doubleAngled"],
    ["angled", "angled"],
    ["square", "square"],
    ["doubleSquare", "doubleSquare"],
    ["doubleDot", "doubleDot"],
  ] as const)("retains the %s variant for explicitly local notation", (shape, expected) => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "fermata", shape };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved, undefined, true);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.fermata).toEqual({ symbol: expected, _x: { viritura: { localOnly: true } } });
    }
  });

  it("applies a fermata without splitting a full-measure rest in 5/2", () => {
    const score = makeScore();
    score.global.measures[0]!.time = { count: 5, unit: 2 };
    score.parts[0]!.measures[0]!.sequences[0] = {
      content: [],
      fullMeasure: { visualDuration: { base: "whole" }, staffPosition: 1 },
    };
    const result = applyBreathFermata(
      score,
      { kind: "single", elementId: "p0/m0/s0/e0" },
      { kind: "fermata", shape: "normal" },
      0,
    );

    expect(result).not.toBeNull();
    const sequence = result!.parts[0]!.measures[0]!.sequences[0]!;
    expect(sequence.content).toEqual([]);
    expect(sequence.fullMeasure).toEqual({
      visualDuration: { base: "whole" },
      staffPosition: 1,
    });
    expect(result!.global.measures[0]!.fermatas).toHaveLength(1);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.fullMeasure?.fermata).toBeUndefined();
  });

  it("broadcasts a condensed full-measure-rest fermata to every source part", () => {
    const score = makeScore();
    score.parts[0]!.id = "part-0";
    score.parts[0]!.measures[0]!.sequences[0] = {
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    };
    score.parts.push({
      id: "part-1",
      name: "Piano 2",
      measures: [{ sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] }],
    });
    score.layouts = [
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "part-0" }, { part: "part-1" }] }],
      },
    ];
    score.scores = [{ name: "Condensed", layout: "condensed" }];

    const result = applyBreathFermata(
      score,
      { kind: "single", elementId: "p0/m0/s0/e0" },
      { kind: "fermata", shape: "normal" },
      0,
    )!;

    const fermata = result.global.measures[0]!.fermatas![0]!;
    expect(result.parts.map((part) => part.measures[0]!.sequences[0]!.fullMeasure?.fermata)).toEqual([
      undefined,
      undefined,
    ]);
    expect(projectGlobalFermata(result, 0, fermata)).toHaveLength(2);
  });

  it("projects a selected range to all staves without modifying any local rests", () => {
    const score = makeScore();
    score.global.measures.push({});
    const emptyMeasure = () => ({
      sequences: [
        { content: [], fullMeasure: { visualDuration: { base: "whole" as const } } },
        { staff: 2, content: [], fullMeasure: { visualDuration: { base: "whole" as const } } },
      ],
    });
    score.parts[0]!.staves = 2;
    const secondMeasure = emptyMeasure();
    secondMeasure.sequences.reverse();
    score.parts[0]!.measures = [emptyMeasure(), secondMeasure];

    const result = applyBreathFermata(
      score,
      { kind: "range", startElementId: "p0/m0/s0/e0", endElementId: "p0/m1/s1/e0" },
      { kind: "fermata", shape: "normal" },
    )!;

    for (const measure of result.parts[0]!.measures) {
      expect(measure.sequences.find((sequence) => (sequence.staff ?? 1) === 1)?.fullMeasure?.fermata).toBeUndefined();
      expect(measure.sequences.find((sequence) => sequence.staff === 2)?.fullMeasure?.fermata).toBeUndefined();
    }
    for (const [mi, measure] of result.global.measures.entries()) {
      expect(measure.fermatas).toHaveLength(1);
      expect(projectGlobalFermata(result, mi, measure.fermatas![0]!)).toHaveLength(2);
    }
  });

  it("deduplicates simultaneous selections and preserves existing playback settings", () => {
    const score = makeScore();
    score.parts.push(structuredClone(score.parts[0]!));
    score.global.measures[0]!.fermatas = [
      { id: "hold", position: { fraction: [0, 1] }, multiplier: 3, clickBehavior: "keepClicking" },
    ];
    const result = applyBreathFermata(
      score,
      { kind: "multi", elementIds: new Set(["p0/m0/s0/ev-1", "p1/m0/s0/ev-1"]) },
      { kind: "fermata", shape: "normal" },
    )!;
    expect(result.global.measures[0]!.fermatas).toEqual(score.global.measures[0]!.fermatas);
    const deleted = computeDeleteSelection(result, {
      kind: "single",
      elementId: globalFermataId(0, "hold"),
      elementType: "fermata",
    });
    expect(deleted.kind).not.toBe("noop");
    if (deleted.kind !== "noop") expect(deleted.score.global.measures[0]!.fermatas).toBeUndefined();
    expect(result.parts).toEqual(score.parts);
  });

  it("uses the selected tuplet event's scaled onset as the fixed global time", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "quarter" } },
        outer: { multiple: 2, duration: { base: "quarter" } },
        content: ["t1", "t2", "t3"].map((id) => ({
          type: "event",
          id,
          duration: { base: "quarter" },
          rest: {},
        })),
      },
    ];
    const result = applyBreathFermata(
      score,
      { kind: "single", elementId: "p0/m0/s0/t2" },
      { kind: "fermata", shape: "normal" },
    )!;
    expect(result.global.measures[0]!.fermatas![0]!.position).toEqual({ fraction: [1, 6] });
  });

  it.each([
    ["angled", 1.5],
    ["square", 2.5],
    ["doubleSquare", 3],
  ] as const)("seeds a shared hold for %s and keeps the shape only on the selected carrier", (shape, multiplier) => {
    const score = makeScore();
    score.parts.push(structuredClone(score.parts[0]!));
    const result = applyBreathFermata(
      score,
      { kind: "single", elementId: "p0/m0/s0/ev-1" },
      { kind: "fermata", shape },
    )!;
    expect(result.global.measures[0]!.fermatas).toEqual([
      {
        id: expect.any(String),
        position: { fraction: [0, 1] },
        multiplier,
      },
    ]);
    const selected = result.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    const unselected = result.parts[1]!.measures[0]!.sequences[0]!.content[0]!;
    expect(selected.type === "event" && selected.fermata).toEqual({
      symbol: shape,
      _x: { viritura: { localOnly: true } },
    });
    expect(unselected.type === "event" && unselected.fermata).toBeUndefined();
  });

  it("lets an explicit duration hint seed the multiplier independently of the chosen shape", () => {
    const result = applyBreathFermata(
      makeScore(),
      { kind: "single", elementId: "p0/m0/s0/ev-1" },
      { kind: "fermata", shape: "angled", duration: "veryLong" },
    )!;
    expect(result.global.measures[0]!.fermatas![0]!.multiplier).toBe(3);
  });

  it("uses the principal event when the selected grace follows the main event", () => {
    const score = makeScore();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content.push({
      type: "grace",
      content: [
        {
          type: "event",
          id: "g",
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "D", octave: 4 } }],
        },
      ],
    });
    const result = applyBreathFermata(
      score,
      { kind: "single", elementId: "p0/m0/s0/ev-1/grace/g" },
      { kind: "fermata", shape: "square" },
    )!;
    expect(result.global.measures[0]!.fermatas![0]!.position).toEqual({ fraction: [0, 1] });
    const main = result.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(main.type === "event" && main.fermata?.symbol).toBe("square");
    const grace = result.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    expect(grace.type === "grace" && grace.content[0]!.fermata).toBeUndefined();
  });
});

describe("applyBreathFermata — caesura", () => {
  it("adds caesura to event markings", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "caesura" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const ev = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings?.caesura).toEqual({});
    }
  });

  it("overwrites existing caesura on event", () => {
    const score = makeScore();
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      ev.markings = { ...ev.markings, caesura: { style: "thick" } };
    }
    const resolved: BreathFermataSelection = { kind: "caesura" };
    const result = applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    expect(result).not.toBeNull();
    const evResult = result!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (evResult.type === "event") {
      // Normal caesura replaces the existing thick one
      expect(evResult.markings?.caesura).toEqual({});
    }
  });

  it("does not mutate the original score", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "caesura" };
    applyBreathFermata(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, resolved);
    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (ev.type === "event") {
      expect(ev.markings?.caesura).toBeUndefined();
    }
  });
});

describe("applyBreathFermata — edge cases", () => {
  it("returns null for non-single selection", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "breath", symbol: "comma" };
    expect(applyBreathFermata(score, { kind: "none" }, resolved)).toBeNull();
  });

  it("returns null for unresolvable event id", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "fermata", shape: "normal" };
    expect(applyBreathFermata(score, { kind: "single", elementId: "p9/m9/s9/ev-missing" }, resolved)).toBeNull();
  });

  it("returns null for invalid barline id with caesura", () => {
    const score = makeScore();
    const resolved: BreathFermataSelection = { kind: "caesura" };
    expect(applyBreathFermata(score, { kind: "single", elementId: "m99/barline" }, resolved)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { addMixedExpression, addDynamic, addDynamicExpression } from "../radialMenu/radialMenuActions";
import type { MixedExpressionToken, ExpressionToken } from "../radialMenu/dynamicExpressionParser";
import type { Selection } from "../store/selectionStore";

function makeSimpleScore(): Score {
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

describe("addMixedExpression", () => {
  it("places dynamic on the measure", () => {
    const score = makeSimpleScore();
    const tokens: MixedExpressionToken[] = [{ type: "dynamic", value: "p" }];
    const result = addMixedExpression(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.dynamics).toHaveLength(1);
    expect(pm.dynamics![0]!.value).toBe("p");
  });

  it("places text expression without inline when no dynamic", () => {
    const score = makeSimpleScore();
    const tokens: MixedExpressionToken[] = [{ type: "text", value: "lovingly" }];
    const result = addMixedExpression(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.expressions).toHaveLength(1);
    expect(pm.expressions![0]!.text).toBe("lovingly");
    expect(pm.expressions![0]!.inline).toBeUndefined();
  });

  it("places both dynamic and text for mixed input", () => {
    const score = makeSimpleScore();
    const tokens: MixedExpressionToken[] = [
      { type: "dynamic", value: "p" },
      { type: "text", value: "dolce" },
    ];
    const result = addMixedExpression(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    expect(result).not.toBeNull();
    const pm = result!.parts[0]!.measures[0]!;
    expect(pm.dynamics).toHaveLength(1);
    expect(pm.dynamics![0]!.value).toBe("p");
    expect(pm.dynamics![0]!.suffix).toBe("dolce");
    expect(pm.expressions).toBeUndefined();
  });

  it("encodes p cresc f as standard dynamics plus expression text across the selection", () => {
    const score = makeSimpleScore();
    score.global.measures = [{ id: "measure-1", time: { count: 4, unit: 4 } }, { id: "measure-2" }];
    score.parts[0]!.measures.push({
      sequences: [
        {
          content: [
            { type: "event", id: "ev-2", duration: { base: "whole" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
          ],
        },
      ],
    });
    const result = addMixedExpression(
      score,
      { kind: "range", startElementId: "p0/m0/s0/ev-1", endElementId: "p0/m0/s0/ev-1" },
      [
        { type: "dynamic", value: "p" },
        { type: "text", value: "cresc" },
        { type: "dynamic", value: "f" },
      ],
    )!;

    expect(result.parts[0]!.measures[0]!.dynamics![0]).toMatchObject({
      type: "immediate",
      value: "p",
      position: { fraction: [0, 1] },
    });
    expect(result.parts[0]!.measures[0]!.expressions![0]).toEqual({
      text: "cresc.",
      position: { fraction: [0, 1] },
    });
    expect(result.parts[0]!.measures[1]!.dynamics![0]).toMatchObject({
      type: "immediate",
      value: "f",
      position: { fraction: [0, 1] },
    });
    expect(result.parts[0]!.measures[0]!.dynamics!.some((group) => group.type === "gradual")).toBe(false);
  });

  it("normalizes dim as the short form of diminuendo", () => {
    const score = makeSimpleScore();
    const result = addMixedExpression(score, { kind: "single", elementId: "p0/m0/s0/ev-1", elementType: "event" }, [
      { type: "dynamic", value: "f" },
      { type: "text", value: "dim" },
      { type: "dynamic", value: "p" },
    ])!;

    expect(result.parts[0]!.measures[0]!.expressions![0]!.text).toBe("dim.");
  });

  it("encodes p cresc as an open textual gradual instead of a small dynamic suffix", () => {
    const result = addMixedExpression(
      makeSimpleScore(),
      { kind: "single", elementId: "p0/m0/s0/ev-1", elementType: "event" },
      [
        { type: "dynamic", value: "p" },
        { type: "text", value: "cresc" },
      ],
    )!;
    const measure = result.parts[0]!.measures[0]!;

    expect(measure.dynamics).toHaveLength(1);
    expect(measure.dynamics![0]).toMatchObject({ type: "immediate", value: "p" });
    expect(measure.dynamics![0]!.suffix).toBeUndefined();
    expect(measure.expressions).toEqual([{ text: "cresc.", position: { fraction: [0, 1] } }]);
  });

  it("encodes f dim as the inverse open textual gradual", () => {
    const result = addMixedExpression(
      makeSimpleScore(),
      { kind: "single", elementId: "p0/m0/s0/ev-1", elementType: "event" },
      [
        { type: "dynamic", value: "f" },
        { type: "text", value: "dim" },
      ],
    )!;

    expect(result.parts[0]!.measures[0]!.expressions![0]!.text).toBe("dim.");
  });

  it.each([
    ["più", "p", "softer"],
    ["piu", "f", "louder"],
    ["meno", "p", "louder"],
    ["meno", "f", "softer"],
  ] as const)("maps %s %s to a relative dynamic group", (qualifier, value, relativeValue) => {
    const score = makeSimpleScore();
    const tokens: MixedExpressionToken[] = [
      { type: "text", value: qualifier },
      { type: "dynamic", value },
    ];
    const result = addMixedExpression(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    const dynamic = result!.parts[0]!.measures[0]!.dynamics![0]!;
    expect(dynamic).toMatchObject({
      type: "relative",
      relativeValue,
      prefix: qualifier,
    });
    expect(dynamic.glyphs).toHaveLength(1);
  });

  it("returns null for unresolvable selection", () => {
    const score = makeSimpleScore();
    const tokens: MixedExpressionToken[] = [{ type: "dynamic", value: "f" }];
    const result = addMixedExpression(score, { kind: "single", elementId: "p9/m9/s9/ev-missing" }, tokens);
    expect(result).toBeNull();
  });

  it("does not mutate the original score", () => {
    const score = makeSimpleScore();
    const tokens: MixedExpressionToken[] = [
      { type: "dynamic", value: "mf" },
      { type: "text", value: "espressivo" },
    ];
    addMixedExpression(score, { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    // Original should be untouched
    expect(score.parts[0]!.measures[0]!.dynamics).toBeUndefined();
    expect(score.parts[0]!.measures[0]!.expressions).toBeUndefined();
  });
});

describe("addDynamicExpression — standard group placement", () => {
  it("renders the starting value before the gradual group and places the target at its end", () => {
    const tokens: ExpressionToken[] = [
      { type: "dynamic", value: "p" },
      { type: "crescendo" },
      { type: "dynamic", value: "f" },
    ];
    const result = addDynamicExpression(makeSimpleScore(), { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    const groups = result!.parts[0]!.measures[0]!.dynamics!;
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      type: "immediate",
      value: "p",
      position: { fraction: [0, 1] },
    });
    expect(groups[1]).toMatchObject({
      type: "gradual",
      position: { fraction: [0, 1] },
      end: { position: { fraction: [1, 1] } },
      wedgeType: "increasing",
    });
    expect(groups[2]).toMatchObject({
      type: "immediate",
      value: "f",
      position: { fraction: [1, 1] },
    });
  });

  it("adds both the starting dynamic and an unfinished hairpin from a condensed note selection", () => {
    const tokens: ExpressionToken[] = [{ type: "dynamic", value: "p" }, { type: "crescendo" }];
    const result = addDynamicExpression(
      makeSimpleScore(),
      { kind: "single", elementId: "p0/m0/s0/ev-1/n0", elementType: "note" },
      tokens,
    );
    const groups = result!.parts[0]!.measures[0]!.dynamics!;

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ type: "immediate", value: "p", position: { fraction: [0, 1] } });
    expect(groups[1]).toMatchObject({
      type: "gradual",
      position: { fraction: [0, 1] },
      wedgeType: "increasing",
    });
    expect(groups[1]!.visuallyContinues).toBe(groups[0]!.id);
  });

  it("places alternating wedges and dynamics at sequential boundaries", () => {
    const tokens: ExpressionToken[] = [
      { type: "dynamic", value: "fp" },
      { type: "crescendo" },
      { type: "dynamic", value: "ff" },
      { type: "diminuendo" },
      { type: "dynamic", value: "p" },
    ];
    const result = addDynamicExpression(makeSimpleScore(), { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    const groups = result!.parts[0]!.measures[0]!.dynamics!;
    expect(groups).toHaveLength(5);
    expect(groups[0]).toMatchObject({
      type: "accent",
      accentPrefix: "",
      value: "f",
      residualValue: "p",
      accentSuffix: "",
      position: { fraction: [0, 1] },
    });
    expect(groups[1]).toMatchObject({
      type: "gradual",
      position: { fraction: [0, 1] },
      end: { position: { fraction: [1, 2] } },
      wedgeType: "increasing",
    });
    expect(groups[2]).toMatchObject({
      type: "immediate",
      value: "ff",
      position: { fraction: [1, 2] },
    });
    expect(groups[3]).toMatchObject({
      type: "gradual",
      position: { fraction: [1, 2] },
      end: { position: { fraction: [1, 1] } },
      wedgeType: "decreasing",
    });
    expect(groups[4]).toMatchObject({
      type: "immediate",
      value: "p",
      position: { fraction: [1, 1] },
    });
    expect(groups[0]!.visuallyContinues).toBeUndefined();
    for (let index = 1; index < groups.length; index++) {
      expect(groups[index]!.visuallyContinues).toBe(groups[index - 1]!.id);
    }
  });

  it("builds a linked list for an expression that starts and ends with hairpins", () => {
    const tokens: ExpressionToken[] = [
      { type: "crescendo" },
      { type: "dynamic", value: "f" },
      { type: "diminuendo" },
      { type: "dynamic", value: "p" },
      { type: "crescendo" },
      { type: "dynamic", value: "f" },
      { type: "diminuendo" },
    ];
    const result = addDynamicExpression(makeSimpleScore(), { kind: "single", elementId: "p0/m0/s0/ev-1" }, tokens);
    const groups = result!.parts[0]!.measures[0]!.dynamics!;

    expect(groups).toHaveLength(7);
    expect(groups.map((group) => group.type)).toEqual([
      "gradual",
      "immediate",
      "gradual",
      "immediate",
      "gradual",
      "immediate",
      "gradual",
    ]);
    expect(groups[0]!.visuallyContinues).toBeUndefined();
    for (let index = 1; index < groups.length; index++) {
      expect(groups[index]!.visuallyContinues).toBe(groups[index - 1]!.id);
    }
  });

  it("segments a compound expression across measure boundaries", () => {
    const score = makeSimpleScore();
    score.global.measures.push({});
    score.parts[0]!.measures.push(structuredClone(score.parts[0]!.measures[0]!));
    score.parts[0]!.measures[1]!.sequences[0]!.content[0]!.id = "ev-2";
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m0/s0/ev-1",
      endElementId: "p0/m1/s0/ev-2",
    };
    const tokens: ExpressionToken[] = [
      { type: "dynamic", value: "p" },
      { type: "crescendo" },
      { type: "dynamic", value: "ff" },
      { type: "diminuendo" },
      { type: "dynamic", value: "p" },
    ];
    const result = addDynamicExpression(score, selection, tokens)!;
    const firstMeasure = result.parts[0]!.measures[0]!.dynamics!;
    const secondMeasure = result.parts[0]!.measures[1]!.dynamics!;
    expect(firstMeasure).toHaveLength(2);
    expect(firstMeasure[0]).toMatchObject({
      type: "immediate",
      value: "p",
      position: { fraction: [0, 1] },
    });
    expect(firstMeasure[1]).toMatchObject({
      type: "gradual",
      end: {
        measure: result.global.measures[0]!.id,
        position: { fraction: [1, 1] },
      },
    });
    expect(secondMeasure).toHaveLength(3);
    expect(secondMeasure[0]).toMatchObject({
      type: "immediate",
      value: "ff",
      position: { fraction: [0, 1] },
    });
    expect(secondMeasure[1]).toMatchObject({
      type: "gradual",
      position: { fraction: [0, 1] },
      end: { position: { fraction: [1, 1] } },
    });
    expect(secondMeasure[2]).toMatchObject({
      type: "immediate",
      value: "p",
      position: { fraction: [1, 1] },
    });
    const chain = [...firstMeasure, ...secondMeasure];
    expect(chain[0]!.visuallyContinues).toBeUndefined();
    for (let index = 1; index < chain.length; index++) {
      expect(chain[index]!.visuallyContinues).toBe(chain[index - 1]!.id);
    }
  });

  it("keeps a hairpin ending at a measure boundary on the preceding measure", () => {
    const score = makeSimpleScore();
    score.global.measures.push({ id: "measure-2" });
    score.parts[0]!.measures.push(structuredClone(score.parts[0]!.measures[0]!));
    score.parts[0]!.measures[1]!.sequences[0]!.content[0]!.id = "ev-2";
    const result = addDynamicExpression(
      score,
      { kind: "range", startElementId: "p0/m0/s0/ev-1", endElementId: "p0/m0/s0/ev-1" },
      [{ type: "crescendo" }],
    );
    const hairpin = result!.parts[0]!.measures[0]!.dynamics![0]!;

    expect(hairpin.end).toEqual({
      measure: result!.global.measures[0]!.id,
      position: { fraction: [1, 1] },
    });
  });

  it("keeps the hairpin at the bar end while placing its dynamic on the next downbeat", () => {
    const score = makeSimpleScore();
    score.global.measures = [{ id: "measure-1", time: { count: 2, unit: 4 } }, { id: "measure-2" }];
    score.parts[0]!.measures = [
      {
        sequences: [
          {
            content: [
              { type: "event", id: "rest", duration: { base: "eighth" }, rest: {} },
              {
                type: "event",
                id: "pickup-1",
                duration: { base: "eighth" },
                notes: [{ pitch: { step: "C", octave: 4 } }],
              },
              {
                type: "event",
                id: "pickup-2",
                duration: { base: "eighth" },
                notes: [{ pitch: { step: "D", octave: 4 } }],
              },
              {
                type: "event",
                id: "pickup-3",
                duration: { base: "eighth" },
                notes: [{ pitch: { step: "E", octave: 4 } }],
              },
            ],
          },
        ],
      },
      {
        sequences: [
          {
            content: [
              {
                type: "event",
                id: "downbeat",
                duration: { base: "whole" },
                notes: [{ pitch: { step: "F", octave: 4 } }],
              },
            ],
          },
        ],
      },
    ];
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m0/s0/pickup-1",
      endElementId: "p0/m0/s0/pickup-3",
    };
    const result = addDynamicExpression(score, selection, [
      { type: "dynamic", value: "p" },
      { type: "crescendo" },
      { type: "dynamic", value: "f" },
    ])!;

    expect(result.parts[0]!.measures[0]!.dynamics![1]).toMatchObject({
      type: "gradual",
      end: { measure: "measure-1", position: { fraction: [1, 2] } },
    });
    expect(result.parts[0]!.measures[1]!.dynamics![0]).toMatchObject({
      type: "immediate",
      value: "f",
      position: { fraction: [0, 1] },
    });
  });
});

describe("addDynamic — multi-staff", () => {
  function makeTwoPartScore(): Score {
    const part = (name: string, id: string) => ({
      name,
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event" as const,
                  id,
                  duration: { base: "whole" as const },
                  notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                },
              ],
            },
          ],
        },
      ],
    });
    return {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [part("Violin", "a0"), part("Cello", "b0")],
    };
  }

  it("places the dynamic on every part of a multi-staff bar selection", () => {
    const score = makeTwoPartScore();
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 1,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const result = addDynamic(score, sel, "f");
    expect(result).not.toBeNull();
    expect(result!.parts[0]!.measures[0]!.dynamics).toHaveLength(1);
    expect(result!.parts[0]!.measures[0]!.dynamics![0]!.value).toBe("f");
    expect(result!.parts[1]!.measures[0]!.dynamics).toHaveLength(1);
    expect(result!.parts[1]!.measures[0]!.dynamics![0]!.value).toBe("f");
  });

  it.each([
    ["p", { type: "immediate", value: "p" }],
    ["fp", { type: "accent", accentPrefix: "", value: "f", residualValue: "p", accentSuffix: "" }],
    ["pf", { type: "accent", accentPrefix: "", value: "p", residualValue: "f", accentSuffix: "" }],
    ["sfz", { type: "accent", value: "f" }],
    ["rfz", { type: "accent", accentPrefix: "r", value: "f" }],
    ["n", { type: "immediate", value: "n" }],
  ] as const)("maps the %s preset to schema-27 semantics", (spelling, expected) => {
    const result = addDynamic(makeSimpleScore(), { kind: "single", elementId: "p0/m0/s0/ev-1" }, spelling);
    expect(result!.parts[0]!.measures[0]!.dynamics![0]).toMatchObject(expected);
  });

  it("spans a hairpin on every staff of a multi-staff bar selection", () => {
    const score = makeTwoPartScore();
    const sel: Selection = {
      kind: "measure",
      startPartIndex: 0,
      endPartIndex: 1,
      startStaffIndex: 0,
      endStaffIndex: 0,
      startMeasure: 0,
      endMeasure: 0,
    };
    const tokens: ExpressionToken[] = [{ type: "crescendo" }];
    const result = addDynamicExpression(score, sel, tokens);
    expect(result).not.toBeNull();
    // Each staff gets its own crescendo hairpin.
    const first = result!.parts[0]!.measures[0]!.dynamics?.filter((group) => group.type === "gradual");
    const second = result!.parts[1]!.measures[0]!.dynamics?.filter((group) => group.type === "gradual");
    expect(first).toHaveLength(1);
    expect(first![0]!.wedgeType).toBe("increasing");
    expect(second).toHaveLength(1);
    expect(second![0]!.wedgeType).toBe("increasing");
  });

  it("applies a dynamic expression to every source of an active condensed staff", () => {
    const score = makeTwoPartScore();
    score.parts[0]!.id = "part-1";
    score.parts[1]!.id = "part-2";
    score.layouts = [
      {
        id: "condensed",
        content: [{ type: "staff", sources: [{ part: "part-1" }, { part: "part-2" }] }],
      },
    ];
    score.scores = [{ name: "Condensed", layout: "condensed" }];
    const selection: Selection = {
      kind: "single",
      elementId: "p0/m0/s0/a0/n0",
      elementType: "note",
    };
    const result = addMixedExpression(
      score,
      selection,
      [
        { type: "dynamic", value: "p" },
        { type: "text", value: "cresc" },
      ],
      0,
    )!;

    for (const part of result.parts) {
      expect(part.measures[0]!.dynamics![0]).toMatchObject({ type: "immediate", value: "p" });
      expect(part.measures[0]!.expressions![0]!.text).toBe("cresc.");
    }
  });

  it.each(["p", "sf"] as const)("applies immediate %s to every event in a multi selection", (value) => {
    const score = makeSimpleScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "event-1",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "event-2",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "D", octave: 4 } }],
      },
      {
        type: "event",
        id: "event-3",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "E", octave: 4 } }],
      },
    ];
    const result = addDynamicExpression(
      score,
      { kind: "multi", elementIds: ["p0/m0/s0/event-1", "p0/m0/s0/event-2", "p0/m0/s0/event-3"] },
      [{ type: "dynamic", value }],
    )!;

    expect(result.parts[0]!.measures[0]!.dynamics).toHaveLength(3);
    expect(result.parts[0]!.measures[0]!.dynamics!.map((dynamic) => dynamic.position.fraction)).toEqual([
      [0, 1],
      [1, 4],
      [1, 2],
    ]);
  });

  it("applies an immediate dynamic to every event in a range selection", () => {
    const score = makeSimpleScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "event-1",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "event-2",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "D", octave: 4 } }],
      },
      {
        type: "event",
        id: "event-3",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "E", octave: 4 } }],
      },
    ];
    const result = addDynamicExpression(
      score,
      { kind: "range", startElementId: "p0/m0/s0/event-1", endElementId: "p0/m0/s0/event-3" },
      [{ type: "dynamic", value: "sf" }],
    )!;

    expect(result.parts[0]!.measures[0]!.dynamics).toHaveLength(3);
  });

  it("ignores rests when applying an immediate dynamic across a range", () => {
    const score = makeSimpleScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "note-1",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      },
      { type: "event", id: "rest-1", duration: { base: "quarter" }, rest: {} },
      {
        type: "event",
        id: "note-2",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "D", octave: 4 } }],
      },
    ];
    const result = addDynamicExpression(
      score,
      { kind: "range", startElementId: "p0/m0/s0/note-1", endElementId: "p0/m0/s0/note-2" },
      [{ type: "dynamic", value: "sf" }],
    )!;

    expect(result.parts[0]!.measures[0]!.dynamics!.map((dynamic) => dynamic.position.fraction)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("keeps a symbolic gradual dynamic as one span over a multi selection", () => {
    const score = makeSimpleScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content = [
      {
        type: "event",
        id: "event-1",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      },
      {
        type: "event",
        id: "event-2",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "D", octave: 4 } }],
      },
    ];
    const result = addDynamicExpression(
      score,
      { kind: "multi", elementIds: ["p0/m0/s0/event-1", "p0/m0/s0/event-2"] },
      [{ type: "dynamic", value: "p" }, { type: "crescendo" }, { type: "dynamic", value: "f" }],
    )!;

    const gradual = result.parts[0]!.measures[0]!.dynamics!.filter((dynamic) => dynamic.type === "gradual");
    expect(gradual).toHaveLength(1);
    expect(gradual[0]).toMatchObject({ end: { position: { fraction: [1, 2] } } });
  });

  it.each(["range", "multi"] as const)(
    "spans an open p< across tied noteheads in adjacent measures for a %s selection",
    (selectionKind) => {
      const score = makeSimpleScore();
      score.global.measures = [{ id: "measure-1", time: { count: 4, unit: 4 } }, { id: "measure-2" }];
      score.parts[0]!.measures = [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "source",
                  duration: { base: "whole" },
                  notes: [{ id: "source-note", pitch: { step: "C", octave: 4 }, ties: [{ target: "target-note" }] }],
                },
              ],
            },
          ],
        },
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: "target",
                  duration: { base: "whole" },
                  notes: [{ id: "target-note", pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ];
      const selection: Selection =
        selectionKind === "range"
          ? {
              kind: "range",
              startElementId: "p0/m0/s0/source/n0",
              endElementId: "p0/m1/s0/target/n0",
            }
          : {
              kind: "multi",
              elementIds: ["p0/m0/s0/source/n0", "p0/m1/s0/target/n0"],
            };
      const result = addDynamicExpression(score, selection, [{ type: "dynamic", value: "p" }, { type: "crescendo" }])!;
      const gradual = result.parts[0]!.measures[0]!.dynamics!.find((dynamic) => dynamic.type === "gradual");

      expect(gradual).toMatchObject({
        position: { fraction: [0, 1] },
        end: { measure: "measure-2", position: { fraction: [1, 1] } },
      });
    },
  );
});

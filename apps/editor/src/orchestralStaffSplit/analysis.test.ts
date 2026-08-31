import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { analyzeOrchestralPartSplit } from ".";

describe("analyzeOrchestralPartSplit", () => {
  it("previews resulting named Parts and routing-label counts without mutating the score", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.expressions = [
      { text: "I.II.", position: { fraction: [0, 1] } },
      { text: "dolce", position: { fraction: [1, 4] } },
    ];
    const before = structuredClone(score);

    const analysis = analyzeOrchestralPartSplit(score);

    expect(analysis.error).toBeNull();
    expect(analysis.parts).toHaveLength(6);
    expect(analysis.parts[0]).toMatchObject({
      id: "P2",
      resultingParts: [
        { id: "P2-1", name: "Oboe 1", shortName: "Ob. 1" },
        { id: "P2-2", name: "Oboe 2", shortName: "Ob. 2" },
      ],
    });
    expect(analysis.recognizedRoutingLabelCount).toBe(1);
    expect(score).toEqual(before);
  });

  it("returns a blocking compatibility error", () => {
    const score = makeScore();
    score.parts = score.parts.filter((part) => part.id !== "P7");

    const analysis = analyzeOrchestralPartSplit(score);

    expect(analysis.parts).toHaveLength(5);
    expect(analysis.error).toMatch(/P7.*missing/);
  });

  it("does not preview an incompatible part that only reuses a target ID", () => {
    const score = makeScore();
    score.parts.find((part) => part.id === "P7")!.name = "Timpani";

    const analysis = analyzeOrchestralPartSplit(score);

    expect(analysis.parts.some((part) => part.id === "P7")).toBe(false);
    expect(analysis.error).toMatch(/Part P7.*unexpected name.*Timpani/);
  });
});

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      ["P2", "Oboi", 1],
      ["P3", "Clarinets in B♭", 2],
      ["P4", "Bassoons", 2],
      ["P5", "Corni in F", 1],
      ["P6", "Trombe in Bb", 1],
      ["P7", "Tromboni", 2],
    ].map(([id, name, staves]) => ({
      id: id as string,
      name: name as string,
      staves: staves as number,
      measures: [
        {
          sequences: Array.from({ length: staves as number }, (_, index) => ({
            staff: index + 1,
            content: [{ type: "event" as const, duration: { base: "whole" as const }, rest: {} }],
          })),
        },
      ],
    })),
  };
}

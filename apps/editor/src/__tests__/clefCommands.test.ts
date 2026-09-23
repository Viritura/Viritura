import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { setClefHiddenForSelection } from "../commands/clefCommands";
import type { NotationSelectionTarget } from "../commands/notationInspectorCommands";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            clefs: [
              { clef: { sign: "G", staffPosition: -2 } },
              { clef: { sign: "F", staffPosition: 2 }, position: { fraction: [1, 2] } },
            ],
            sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
    ],
  };
}

function clefTarget(elementId: string, clefIndex?: number): NotationSelectionTarget {
  return {
    elementId,
    elementType: "clef",
    partIndex: 0,
    measureIndex: 0,
    ...(clefIndex === undefined ? {} : { clefIndex }),
  };
}

describe("setClefHiddenForSelection", () => {
  it("updates only the selected positioned clef", () => {
    const score = makeScore();

    const next = setClefHiddenForSelection(score, clefTarget("p0/m0/clef1", 1), true);

    expect(next.parts[0]!.measures[0]!.clefs).toEqual([
      { clef: { sign: "G", staffPosition: -2 } },
      { clef: { sign: "F", staffPosition: 2, hide: true }, position: { fraction: [1, 2] } },
    ]);
  });

  it("falls back to the first clef for the legacy generic clef id", () => {
    const score = makeScore();

    const next = setClefHiddenForSelection(score, clefTarget("p0/m0/clef"), true);

    expect(next.parts[0]!.measures[0]!.clefs).toEqual([
      { clef: { sign: "G", staffPosition: -2, hide: true } },
      { clef: { sign: "F", staffPosition: 2 }, position: { fraction: [1, 2] } },
    ]);
  });
});

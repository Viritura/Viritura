import { describe, expect, it } from "vitest";
import type { Score, Tuplet } from "@viritura/core";
import { applyTupletFromRadialMenu } from "../radialMenu/applyTupletFromRadialMenu";
import { initialNoteInputState } from "../store/noteInputStore";

function scoreWithWholeRest(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ measures: [{ sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }] }] }],
  };
}

describe("applyTupletFromRadialMenu", () => {
  it("creates a custom ratio at the actual cursor using the selected duration as its total span", () => {
    const result = applyTupletFromRadialMenu({
      score: scoreWithWholeRest(),
      noteInputState: {
        ...initialNoteInputState,
        active: true,
        currentDuration: "quarter",
        dotCount: 1,
        cursorPosition: { measureIndex: 0, beatPosition: 1, partIndex: 0 },
      },
      selection: { kind: "none" },
      tupletNumber: 5,
      customOuter: 3,
    });

    const content = result.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]!.type).toBe("event");
    expect(content[1]!.type).toBe("tuplet");
    const tuplet = content[1] as Tuplet;
    expect(tuplet.inner).toEqual({ multiple: 5, duration: { base: "eighth" } });
    expect(tuplet.outer).toEqual({ multiple: 3, duration: { base: "eighth" } });
  });
});

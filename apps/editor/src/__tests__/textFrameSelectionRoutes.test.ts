import { describe, expect, it } from "vitest";
import { textContentFromPlain, type Score, type TextFrame } from "@viritura/core";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { resolveNotationSelectionTarget } from "../commands/notationInspectorCommands";
import { parseElementType } from "../score/elementTypes";
import { isSelectionIdValid } from "../store/useSelectionPruner";

function frame(id: string): TextFrame {
  return {
    id,
    locator: { type: "page", pageIndex: 0 },
    placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
    width: { unit: "staffSpaces", value: 20 },
    content: textContentFromPlain(id),
  };
}

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ id: "m1" }] },
  parts: [{ id: "P1", measures: [{ sequences: [{ content: [] }] }] }],
  scores: [
    { name: "Full", textFrames: [frame("notes/clef1"), frame("intro")] },
    { name: "Part", textFrames: [frame("part-only")] },
  ],
};

const single = (elementId: string) =>
  ({ kind: "single", elementId, elementType: parseElementType(elementId) }) as const;

describe("text-frame element IDs", () => {
  it("classify as text frames regardless of the authored frame ID", () => {
    expect(parseElementType("text-frame/notes%2Fclef1")).toBe("text-frame");
    expect(parseElementType("text-frame/intro")).toBe("text-frame");
  });

  it("stay selected while the frame exists in the active view", () => {
    expect(isSelectionIdValid("text-frame/notes%2Fclef1", SCORE, 0)).toBe(true);
    expect(isSelectionIdValid("text-frame/part-only", SCORE, 0)).toBe(false);
    expect(isSelectionIdValid("text-frame/part-only", SCORE, 1)).toBe(true);
    expect(isSelectionIdValid("text-frame/part-only", SCORE)).toBe(true);
    expect(isSelectionIdValid("text-frame/gone", SCORE, 0)).toBe(false);
  });

  it("are not routed to the notation inspector", () => {
    expect(resolveNotationSelectionTarget(single("text-frame/intro"), SCORE)).toBeNull();
  });

  it("keeps a system-text selection valid only while its global ID exists", () => {
    const score: Score = {
      ...SCORE,
      global: {
        measures: [
          {
            id: "m1",
            systemText: [{ id: "note-1", text: textContentFromPlain("See note"), position: { fraction: [0, 1] } }],
          },
        ],
      },
    };
    expect(isSelectionIdValid("m0/systemText/note-1", score)).toBe(true);
    expect(isSelectionIdValid("m0/systemText/gone", score)).toBe(false);
  });

  it("delete only the frame in the active view", () => {
    const result = computeDeleteSelection(SCORE, single("text-frame/notes%2Fclef1"), 0);
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.score.scores?.[0]?.textFrames?.map((f) => f.id)).toEqual(["intro"]);
    expect(result.score.scores?.[1]?.textFrames?.map((f) => f.id)).toEqual(["part-only"]);
    expect(result.nextSelection).toEqual({ kind: "clear" });
    expect(computeDeleteSelection(SCORE, single("text-frame/part-only"), 0).kind).toBe("noop");
  });
});

import { describe, expect, it, vi } from "vitest";
import { textContentFromPlain, type Score } from "@viritura/core";
import { handleDelete } from "../keyboard/normalModeDelete";
import type { KeyboardHandlerContext } from "../keyboard/types";

const SCORE: Score = {
  mnx: { version: 1 },
  global: { measures: [{ id: "m1" }] },
  parts: [{ id: "P1", measures: [{ sequences: [{ content: [] }] }] }],
  scores: [
    {
      name: "Full",
      textFrames: ["a/b", "keep"].map((id) => ({
        id,
        locator: { type: "page", pageIndex: 0 },
        placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
        width: { unit: "staffSpaces", value: 20 },
        content: textContentFromPlain(id),
      })),
    },
  ],
};

function contextFor(elementId: string) {
  const updateScore = vi.fn<(score: Score) => void>();
  const clearSelection = vi.fn();
  const ctx = {
    getSelection: () => ({ kind: "single", elementId }),
    getScore: () => SCORE,
    getConfig: () => ({ selectedScoreIndex: 0 }),
    updateScore,
    clearSelection,
  } as unknown as KeyboardHandlerContext;
  return { ctx, updateScore, clearSelection };
}

describe("Delete on a canvas-selected text frame", () => {
  it("removes the frame named by its sanitized display-list ID as one edit", () => {
    const { ctx, updateScore, clearSelection } = contextFor("text-frame/a%2Fb");
    handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, ctx);
    expect(updateScore).toHaveBeenCalledOnce();
    expect(updateScore.mock.calls[0]![0].scores?.[0]?.textFrames?.map((frame) => frame.id)).toEqual(["keep"]);
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it("ignores IDs that name no frame in the active view", () => {
    const { ctx, updateScore } = contextFor("text-frame/missing");
    handleDelete(new KeyboardEvent("keydown", { key: "Delete" }), false, ctx);
    expect(updateScore).not.toHaveBeenCalled();
  });
});

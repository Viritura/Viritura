import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { createDocumentStore } from "../store/documentStore";
import { useScoreListActions } from "./useScoreListActions";

function scoreWithPartEntry(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [] },
    parts: [
      { id: "p1", name: "Flute", measures: [] },
      { id: "p2", name: "Oboe", measures: [] },
      { id: "p3", name: "Piano", measures: [], staves: 2 },
    ],
    layouts: [
      {
        id: "full",
        content: [
          { type: "staff", sources: [{ part: "p1" }] },
          { type: "staff", sources: [{ part: "p2" }] },
        ],
      },
      {
        id: "reduction",
        content: [{ type: "staff", sources: [{ part: "p1" }, { part: "p2" }] }],
      },
      {
        id: "piano",
        content: [
          {
            type: "group",
            content: [
              { type: "staff", sources: [{ part: "p3", staff: 1 }] },
              { type: "staff", sources: [{ part: "p3", staff: 2 }] },
            ],
          },
        ],
      },
      { id: "flute", content: [{ type: "staff", sources: [{ part: "p1" }] }] },
    ],
    scores: [
      { name: "Full Score", layout: "full" },
      { name: "Chamber Reduction", layout: "reduction" },
      { name: "Piano", layout: "piano" },
      { name: "Flute", layout: "flute" },
    ],
  };
}

describe("useScoreListActions", () => {
  it.each([
    ["full", "Full Score (copy)"],
    ["condensed", "Condensed Score"],
  ] as const)("inserts a new %s score before instrumental parts", (type, expectedName) => {
    const score = scoreWithPartEntry();
    const store = createDocumentStore();
    store.setState({ score, workingScore: score });
    const updateScore = vi.fn();
    const setSelectedScoreIndex = vi.fn();
    const { result } = renderHook(() =>
      useScoreListActions({
        store,
        updateScore,
        selectedScoreIndex: 0,
        setSelectedScoreIndex,
        setExpandedCondensingStaves: vi.fn(),
      }),
    );

    act(() => result.current.handleAddScore(type));

    const updated = updateScore.mock.calls[0]?.[0] as Score;
    expect(updated.scores?.map((entry) => entry.name)).toEqual([
      "Full Score",
      "Chamber Reduction",
      expectedName,
      "Piano",
      "Flute",
    ]);
    expect(setSelectedScoreIndex).toHaveBeenCalledWith(2);
  });
});

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { resolveActiveInstrument } from "@viritura/core";
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
        id: "keyboard.piano",
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
      { id: "wind.flutes.flute", content: [{ type: "staff", sources: [{ part: "p1" }] }] },
    ],
    scores: [
      { name: "Full Score", layout: "full" },
      { name: "Chamber Reduction", layout: "reduction" },
      { name: "Piano", layout: "keyboard.piano" },
      { name: "Flute", layout: "wind.flutes.flute" },
    ],
  };
}

describe("useScoreListActions", () => {
  it("keeps the initial definition consistent when Setup changes transposition", () => {
    const score = scoreWithPartEntry();
    score.global.measures = [{}, {}];
    score.parts[0] = {
      id: "p1",
      name: "Flute",
      _x: {
        viritura: {
          instrumentId: "wind.flutes.flute",
          initialInstrument: "fl",
          instruments: {
            fl: { instrumentId: "wind.flutes.flute", name: "Flute" },
            ob: { instrumentId: "wind.reed.oboe", name: "Oboe" },
          },
        },
      },
      measures: [
        { sequences: [{ content: [] }] },
        { sequences: [{ content: [] }], instrumentChanges: [{ instrument: "ob" }] },
      ],
    };
    const store = createDocumentStore();
    store.setState({ score, workingScore: score });
    const updateScore = vi.fn<(score: Score) => void>();
    const { result } = renderHook(() =>
      useScoreListActions({
        store,
        updateScore,
        selectedScoreIndex: 0,
        setSelectedScoreIndex: vi.fn(),
        setExpandedCondensingStaves: vi.fn(),
      }),
    );
    act(() =>
      result.current.handlePartUpdate("p1", { transposition: { interval: { halfSteps: 2, staffDistance: 1 } } }),
    );
    const part = updateScore.mock.calls[0]![0].parts[0]!;
    expect(resolveActiveInstrument(part, 0).instrument?.transposition?.interval.halfSteps).toBe(2);
    expect(resolveActiveInstrument(part, 1).transposition).toBeUndefined();
  });
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

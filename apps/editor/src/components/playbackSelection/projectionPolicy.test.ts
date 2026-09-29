import type { Score } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { describe, expect, it } from "vitest";
import type { SelectionState } from "../../store/selectionStore";
import { injectSyntheticLayout } from "../ScoreCanvas/layoutHelpers";
import { computeSelectionPartIds } from "./selectionPartIds";

const score: Score = {
  mnx: { version: 1 },
  global: {
    measures: [
      {
        id: "m1",
        chordSymbols: [{ position: { fraction: [1, 2] }, root: { step: "G" }, bass: { step: "B" } }],
      },
    ],
  },
  parts: [
    { id: "wind.flutes.flute", measures: [], chordSymbolVisibility: "hide" },
    { id: "keyboard.piano", measures: [] },
    { id: "strings.cello", measures: [], chordSymbolVisibility: "show" },
  ],
  scores: [{ layout: "condensed", useWritten: true }],
  layouts: [
    {
      id: "condensed",
      content: [
        {
          type: "group",
          content: [
            {
              type: "staff",
              sources: [{ part: "strings.cello", staff: 1, voice: "solo" }, { part: "wind.flutes.flute" }],
            },
            { type: "staff", sources: [{ part: "keyboard.piano" }] },
          ],
        },
      ],
    },
  ],
};

const selection: Extract<SelectionState, { kind: "measure" }> = {
  kind: "measure",
  startPartIndex: 2,
  endPartIndex: 2,
  startStaffIndex: 0,
  endStaffIndex: 0,
  startMeasure: 0,
  endMeasure: 0,
};

describe("filtered staff playback policy", () => {
  it.each([
    { partIds: ["strings.cello"] },
    { partIds: ["wind.flutes.flute"] },
    { partIds: ["strings.cello", "keyboard.piano"] },
  ])("keeps every retained instrument source and the single global chord stream (filter=$partIds)", ({ partIds }) => {
    const wire = serializeMnx(score);
    const projection = injectSyntheticLayout(JSON.stringify(wire), partIds, 0);
    const projected = parseMnx(JSON.parse(projection.json));
    const definition = projected.scores![projection.scoreIndex]!;
    const layout = projected.layouts!.find(({ id }) => id === definition.layout)!;
    const group = layout.content[0]!;
    expect(group.type).toBe("group");
    if (group.type !== "group") throw new Error("Expected retained group");
    expect(group.content[0]).toEqual({
      type: "staff",
      sources: [{ part: "strings.cello", staff: 1, voice: "solo" }, { part: "wind.flutes.flute" }],
    });
    expect(group.content).toHaveLength(partIds.includes("keyboard.piano") ? 2 : 1);
    expect(definition.useWritten).toBe(true);
    expect(projected.global).toEqual(parseMnx(wire).global);
    expect(projected.parts).toEqual(parseMnx(wire).parts);

    const expected = ["wind.flutes.flute", "strings.cello"];
    expect(computeSelectionPartIds(selection, score, 0, partIds)).toEqual(expected);
    expect(computeSelectionPartIds(selection, projected, projection.scoreIndex)).toEqual(expected);
    expect(
      computeSelectionPartIds(selection, score, 0, partIds, [
        { staffIndex: 0, measureIndex: 0, partIds: ["strings.cello", "wind.flutes.flute"] },
      ]),
    ).toEqual(expected);
  });
});

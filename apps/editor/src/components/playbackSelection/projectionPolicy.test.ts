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
    { id: "flute", measures: [], chordSymbolVisibility: "hide" },
    { id: "piano", measures: [] },
    { id: "cello", measures: [], chordSymbolVisibility: "show" },
  ],
  scores: [{ layout: "condensed", useWritten: true }],
  layouts: [
    {
      id: "condensed",
      content: [
        {
          type: "group",
          content: [
            { type: "staff", sources: [{ part: "cello", staff: 1, voice: "solo" }, { part: "flute" }] },
            { type: "staff", sources: [{ part: "piano" }] },
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
  it.each([{ partIds: ["cello"] }, { partIds: ["flute"] }, { partIds: ["cello", "piano"] }])(
    "keeps every retained instrument source and the single global chord stream (filter=$partIds)",
    ({ partIds }) => {
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
        sources: [{ part: "cello", staff: 1, voice: "solo" }, { part: "flute" }],
      });
      expect(group.content).toHaveLength(partIds.includes("piano") ? 2 : 1);
      expect(definition.useWritten).toBe(true);
      expect(projected.global).toEqual(parseMnx(wire).global);
      expect(projected.parts).toEqual(parseMnx(wire).parts);

      const expected = ["flute", "cello"];
      expect(computeSelectionPartIds(selection, score, 0, partIds)).toEqual(expected);
      expect(computeSelectionPartIds(selection, projected, projection.scoreIndex)).toEqual(expected);
      expect(
        computeSelectionPartIds(selection, score, 0, partIds, [
          { staffIndex: 0, measureIndex: 0, partIds: ["cello", "flute"] },
        ]),
      ).toEqual(expected);
    },
  );
});

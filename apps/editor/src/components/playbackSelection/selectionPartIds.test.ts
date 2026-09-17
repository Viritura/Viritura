import type { Score } from "@viritura/core";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSelectionStore, useSelectionStore, type SelectionState } from "../../store/selectionStore";
import { computeSelectionPartIds } from "./selectionPartIds";

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{}, {}, {}] },
  parts: [
    { id: "flute-source", name: "Flute", measures: [] },
    { id: "piano-source", name: "Piano", staves: 2, measures: [] },
    { id: "cello-source", name: "Cello", measures: [] },
  ],
  layouts: [
    {
      id: "condensed-display",
      content: [
        { type: "staff", sources: [{ part: "cello-source" }, { part: "flute-source" }] },
        { type: "staff", sources: [{ part: "piano-source", staff: 1 }] },
        { type: "staff", sources: [{ part: "piano-source", staff: 2 }] },
      ],
    },
  ],
};

const measure: Extract<SelectionState, { kind: "measure" }> = {
  kind: "measure",
  startPartIndex: 1,
  endPartIndex: 1,
  startStaffIndex: 2,
  endStaffIndex: 2,
  startLocalStaffIndex: 1,
  endLocalStaffIndex: 1,
  startMeasure: 0,
  endMeasure: 2,
};

describe("computeSelectionPartIds", () => {
  it.each<SelectionState>([
    { kind: "none" },
    { kind: "single", elementId: "p1/m0/s0/note/n0", elementType: "note" },
    { kind: "single", elementId: "p1/m0/clef", elementType: "clef" },
    { kind: "range", startElementId: "p0/m0/s0/note", endElementId: "p2/m2/s0/note" },
    { kind: "multi", elementIds: ["p0/m0/s0/note", "p2/m2/s0/note"] },
  ])("does not filter $kind selections", (selection) => {
    expect(computeSelectionPartIds(selection, score)).toBeNull();
  });

  describe("whole-measure visual selection identities", () => {
    beforeEach(() => resetSelectionStore());

    const reordered: Score = {
      ...score,
      scores: [
        { name: "Reordered", layout: "reordered" },
        { name: "Condensed", layout: "condensed-display" },
      ],
      layouts: [
        ...score.layouts!,
        {
          id: "reordered",
          content: [
            { type: "staff", sources: [{ part: "piano-source", staff: 2 }] },
            {
              type: "group",
              content: [
                { type: "staff", sources: [{ part: "flute-source" }] },
                { type: "staff", sources: [{ part: "cello-source" }] },
              ],
            },
          ],
        },
      ],
    };

    function selectSpan(startPart: number, startStaff: number, endPart: number, endStaff: number) {
      const { _dispatch } = useSelectionStore.getState();
      _dispatch({ type: "SELECT_MEASURE", partIndex: startPart, staffIndex: startStaff, measureIndex: 0 });
      _dispatch({ type: "EXTEND_MEASURE", partIndex: endPart, staffIndex: endStaff, measureIndex: 2 });
      return useSelectionStore.getState().selection;
    }

    it.each([false, true])("includes the intervening visual source after reordering (reverse=%s)", (reverse) => {
      const selection = reverse ? selectSpan(2, 2, 1, 0) : selectSpan(1, 0, 2, 2);
      expect(computeSelectionPartIds(selection, reordered)).toEqual(["flute-source", "piano-source", "cello-source"]);
    });

    it.each([false, true])("does not include a source outside the visual span (reverse=%s)", (reverse) => {
      const selection = reverse ? selectSpan(2, 2, 0, 1) : selectSpan(0, 1, 2, 2);
      expect(computeSelectionPartIds(selection, reordered)).toEqual(["flute-source", "cello-source"]);
    });

    it("includes every condensed source, not the source-index interval between them", () => {
      const selection = selectSpan(2, 0, 2, 0);
      expect(computeSelectionPartIds(selection, reordered, 1)).toEqual(["flute-source", "cello-source"]);
    });

    it("includes whole instruments when a condensed source names only one staff and voice", () => {
      const condensed: Score = {
        ...reordered,
        layouts: [
          {
            id: "reordered",
            content: [
              {
                type: "staff",
                sources: [{ part: "piano-source", staff: 2, voice: "1" }, { part: "flute-source" }],
              },
            ],
          },
        ],
      };
      expect(computeSelectionPartIds(selectSpan(1, 0, 1, 0), condensed)).toEqual(["flute-source", "piano-source"]);
    });

    it.each([1, 2])("includes the whole piano when selecting only visual staff %s", (staffIndex) => {
      const selection = selectSpan(1, staffIndex, 1, staffIndex);
      expect(computeSelectionPartIds(selection, reordered, 1)).toEqual(["piano-source"]);
    });

    it.each([false, true])("includes all staves and deduplicates condensed sources (reverse=%s)", (reverse) => {
      const selection = reverse ? selectSpan(1, 2, 2, 0) : selectSpan(2, 0, 1, 2);
      expect(computeSelectionPartIds(selection, reordered, 1)).toEqual([
        "flute-source",
        "piano-source",
        "cello-source",
      ]);
    });

    it("does not replace an unresolved active visual staff with a source-index guess", () => {
      expect(computeSelectionPartIds(selectSpan(1, 9, 2, 10), reordered)).toBeNull();
    });

    it("maps the filtered visual span rather than indexing the unfiltered layout", () => {
      expect(computeSelectionPartIds(selectSpan(0, 0, 0, 0), reordered, 0, ["flute-source", "cello-source"])).toEqual([
        "flute-source",
      ]);
    });

    it("keeps all sources of a retained condensed staff in a filtered view", () => {
      expect(computeSelectionPartIds(selectSpan(2, 0, 2, 0), reordered, 1, ["cello-source", "piano-source"])).toEqual([
        "flute-source",
        "cello-source",
      ]);
    });

    it("ignores missing source references rather than returning layout or invented IDs", () => {
      const withMissingSource: Score = {
        ...reordered,
        layouts: [{ id: "reordered", content: [{ type: "staff", sources: [{ part: "missing-source" }] }] }],
      };
      expect(computeSelectionPartIds(selectSpan(1, 0, 1, 0), withMissingSource)).toBeNull();
    });

    it("does not filter note or element-range actions even with visual measure anchors", () => {
      const { _dispatch } = useSelectionStore.getState();
      _dispatch({
        type: "SELECT_ELEMENT",
        elementId: "p1/m0/s0/note/n0",
        measureAnchor: { partIndex: 1, staffIndex: 0, measureIndex: 0 },
      });
      expect(computeSelectionPartIds(useSelectionStore.getState().selection, reordered)).toBeNull();
      _dispatch({ type: "EXTEND_SELECTION", elementId: "p2/m2/s0/note/n0" });
      expect(computeSelectionPartIds(useSelectionStore.getState().selection, reordered)).toBeNull();
    });
  });

  it("selects the entire instrument when only its lower staff is selected", () => {
    expect(computeSelectionPartIds(measure, score)).toEqual(["piano-source"]);
    expect(computeSelectionPartIds({ ...measure, startStaffIndex: 1, startLocalStaffIndex: 0 }, score)).toEqual([
      "piano-source",
    ]);
  });

  it("normalizes reversed part bounds and includes every intervening source part", () => {
    expect(computeSelectionPartIds({ ...measure, startPartIndex: 2, endPartIndex: 0 }, score)).toEqual([
      "flute-source",
      "piano-source",
      "cello-source",
    ]);
  });

  it("falls back to source indices when no score definition activates a layout", () => {
    expect(
      computeSelectionPartIds(
        { ...measure, startPartIndex: 2, endPartIndex: 2, startStaffIndex: 0, endStaffIndex: 0 },
        score,
      ),
    ).toEqual(["cello-source"]);
  });

  it("does not invent IDs for unnamed parts or return display/layout IDs", () => {
    const withoutIds: Score = { ...score, parts: [{ name: "Unnamed", measures: [] }, score.parts[1]!] };
    expect(computeSelectionPartIds({ ...measure, startPartIndex: 0 }, withoutIds)).toEqual(["piano-source"]);
    expect(computeSelectionPartIds({ ...measure, startPartIndex: 0, endPartIndex: 0 }, withoutIds)).toBeNull();
  });

  it("returns no filter when no source parts can be resolved", () => {
    expect(computeSelectionPartIds(measure, null)).toBeNull();
    expect(computeSelectionPartIds(measure, { ...score, parts: [] })).toBeNull();
    expect(computeSelectionPartIds({ ...measure, startPartIndex: 9, endPartIndex: 10 }, score)).toBeNull();
    expect(computeSelectionPartIds({ ...measure, startPartIndex: -2, endPartIndex: -1 }, score)).toBeNull();
  });
});

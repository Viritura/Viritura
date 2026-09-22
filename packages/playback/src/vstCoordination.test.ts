import { describe, expect, it } from "vitest";
import { CHORDS_PART_ID, type Part } from "@viritura/core";
import { computeViewPartFilter } from "./vstCoordination";

const parts: Part[] = ["a", "b", "c"].map((id) => ({
  id,
  name: id,
  measures: [],
  chordSymbolVisibility: "hide",
}));

interface ViewCase {
  name: string;
  visiblePartIds?: string[];
  selectionPartIds?: string[] | null;
  expected: number[] | null;
}

const cases: ViewCase[] = [
  { name: "unselected full score", expected: null },
  { name: "null selection", selectionPartIds: null, expected: null },
  { name: "empty visibility means full score", visiblePartIds: [], expected: null },
  { name: "stale visibility means full score", visiblePartIds: ["missing"], expected: null },
  { name: "current part with visually hidden harmony", visiblePartIds: ["b"], expected: [1, 3] },
  { name: "multiple visible parts", visiblePartIds: ["a", "c"], expected: [0, 2, 3] },
  { name: "empty full-score selection", selectionPartIds: [], expected: [] },
  { name: "empty current-part selection", visiblePartIds: ["b"], selectionPartIds: [], expected: [] },
  { name: "unknown selection", selectionPartIds: ["missing"], expected: [] },
  { name: "derived lane is not a source selection", selectionPartIds: [CHORDS_PART_ID], expected: [] },
  { name: "full-score subset", selectionPartIds: ["a", "b"], expected: [0, 1] },
  { name: "full-score complete selection", selectionPartIds: ["a", "b", "c"], expected: [0, 1, 2, 3] },
  { name: "selected current part", visiblePartIds: ["b"], selectionPartIds: ["b"], expected: [1, 3] },
  { name: "selection outside current part", visiblePartIds: ["b"], selectionPartIds: ["a"], expected: [] },
  { name: "visible subset", visiblePartIds: ["a", "b"], selectionPartIds: ["a", "c"], expected: [0] },
  { name: "all visible parts", visiblePartIds: ["a", "b"], selectionPartIds: ["a", "b"], expected: [0, 1, 3] },
  {
    name: "full-score selection in a filtered view",
    visiblePartIds: ["a", "b"],
    selectionPartIds: ["a", "b", "c"],
    expected: [0, 1, 3],
  },
  {
    name: "duplicates and stale IDs do not alter complete selection",
    visiblePartIds: ["a", "a", "b", "missing"],
    selectionPartIds: ["b", "a", "a", "missing"],
    expected: [0, 1, 3],
  },
  {
    name: "duplicate selections cannot stand in for another visible part",
    visiblePartIds: ["a", "b"],
    selectionPartIds: ["a", "a"],
    expected: [0],
  },
];

describe("computeViewPartFilter global harmony", () => {
  for (const owned of [[], [0], [3], [0, 3], [0, 1, 2], [0, 1, 2, 3], [99]]) {
    describe(`native ownership [${owned.join(", ")}]`, () => {
      it.each(cases)("$name", ({ visiblePartIds, selectionPartIds, expected }) => {
        const vstOwnedParts = new Set(owned);
        const result = computeViewPartFilter({
          parts,
          visiblePartIds,
          selectionPartIds,
          vstOwnedParts,
          chordPartIndex: 3,
        });
        const eligible = expected ?? [0, 1, 2, 3];
        expect(result).toEqual(
          expected === null && owned.length === 0
            ? null
            : new Set(eligible.filter((index) => !vstOwnedParts.has(index))),
        );
        expect([...vstOwnedParts]).toEqual(owned);
      });
    });
  }

  it.each(cases)("preserves no-chord behavior: $name", ({ visiblePartIds, selectionPartIds, expected }) => {
    expect(computeViewPartFilter({ parts, visiblePartIds, selectionPartIds, vstOwnedParts: new Set() })).toEqual(
      expected === null ? null : new Set(expected.filter((index) => index !== 3)),
    );
  });

  it("does not invent a chord lane when only instruments have native ownership", () => {
    expect(computeViewPartFilter({ parts, visiblePartIds: undefined, vstOwnedParts: new Set([1]) })).toEqual(
      new Set([0, 2]),
    );
  });

  it("uses the supplied extra-lane index rather than assuming a contiguous index", () => {
    expect(
      computeViewPartFilter({
        parts,
        visiblePartIds: undefined,
        vstOwnedParts: new Set([0]),
        chordPartIndex: 8,
      }),
    ).toEqual(new Set([1, 2, 8]));
  });

  it.each([{ selectionPartIds: [] }, { selectionPartIds: ["missing"] }])(
    "does not widen a chord-only score's explicit $selectionPartIds selection",
    ({ selectionPartIds }) => {
      expect(
        computeViewPartFilter({
          parts: [],
          visiblePartIds: undefined,
          selectionPartIds,
          vstOwnedParts: new Set(),
          chordPartIndex: 0,
        }),
      ).toEqual(new Set());
    },
  );

  it("retains an unowned chord-only lane at index zero when enumerating native exclusions", () => {
    expect(
      computeViewPartFilter({
        parts: [],
        visiblePartIds: undefined,
        vstOwnedParts: new Set([99]),
        chordPartIndex: 0,
      }),
    ).toEqual(new Set([0]));
  });

  it("subtracts native ownership of a chord-only lane at index zero", () => {
    expect(
      computeViewPartFilter({
        parts: [],
        visiblePartIds: undefined,
        vstOwnedParts: new Set([0]),
        chordPartIndex: 0,
      }),
    ).toEqual(new Set());
  });

  it("does not call a partial selection complete when an unselected source has no ID", () => {
    expect(
      computeViewPartFilter({
        parts: [...parts, { name: "Unnamed", measures: [] }],
        visiblePartIds: undefined,
        selectionPartIds: ["a", "b", "c"],
        vstOwnedParts: new Set(),
        chordPartIndex: 4,
      }),
    ).toEqual(new Set([0, 1, 2]));
  });
});

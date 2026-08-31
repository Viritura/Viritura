import { describe, it, expect } from "vitest";
import type { LayoutContent } from "@viritura/core";
import { allSameParent, normalizeGroupSelection, pruneDescendantPaths, collapseSelectionToGroups } from "../treeOps";

/** Build a leaf staff node for a single part. */
function staff(part: string): LayoutContent {
  return { type: "staff", sources: [{ part }] } as unknown as LayoutContent;
}

/** Build a bracket group wrapping the given children. */
function group(label: string, content: LayoutContent[]): LayoutContent {
  return { type: "group", symbol: "bracket", label, content } as unknown as LayoutContent;
}

// A brass section laid out like the Rhapsody score: two condensed horn groups,
// a condensed trumpet group + a standalone third trumpet, a condensed trombone
// group + standalone third trombone, and a standalone tuba — all siblings at
// the root.
const brass: LayoutContent[] = [
  group("Horn 1/2", [staff("hn1"), staff("hn2")]), // [0]  children 0-0, 0-1
  group("Horn 3/4", [staff("hn3"), staff("hn4")]), // [1]  children 1-0, 1-1
  group("Trumpet 1/2", [staff("tp1"), staff("tp2")]), // [2]
  staff("tp3"), // [3]
  group("Trombone 1/2", [staff("tb1"), staff("tb2")]), // [4]
  staff("tb3"), // [5]
  staff("tuba"), // [6]
];

describe("normalizeGroupSelection", () => {
  it("rolls fully-selected groups up to the group so a section run is sibling-groupable", () => {
    // User selected every leaf staff across the brass section.
    const raw = ["0-0", "0-1", "1-0", "1-1", "2-0", "2-1", "3", "4-0", "4-1", "5", "6"];
    const keys = normalizeGroupSelection(brass, raw);
    expect(new Set(keys)).toEqual(new Set(["0", "1", "2", "3", "4", "5", "6"]));
    expect(allSameParent(keys)).toBe(true);
  });

  it("collapses both horn groups when all four horn leaves are selected", () => {
    const keys = normalizeGroupSelection(brass, ["0-0", "0-1", "1-0", "1-1"]);
    expect(new Set(keys)).toEqual(new Set(["0", "1"]));
    expect(allSameParent(keys)).toBe(true);
  });

  it("leaves a partially-selected group's leaves untouched (still cross-parent)", () => {
    // Horn 1/2 fully selected (→ group "0"), but only one leaf of Horn 3/4.
    const keys = normalizeGroupSelection(brass, ["0-0", "0-1", "1-0"]);
    expect(new Set(keys)).toEqual(new Set(["0", "1-0"]));
    expect(allSameParent(keys)).toBe(false);
  });

  it("is idempotent on an already-normalized sibling selection", () => {
    const keys = normalizeGroupSelection(brass, ["0", "1", "2"]);
    expect(new Set(keys)).toEqual(new Set(["0", "1", "2"]));
  });
});

describe("pruneDescendantPaths", () => {
  it("drops children already carried by a selected ancestor group", () => {
    const keys = pruneDescendantPaths(["0", "0-0", "0-1", "1"]);
    expect(new Set(keys)).toEqual(new Set(["0", "1"]));
  });
});

describe("collapseSelectionToGroups", () => {
  it("does not collapse when a group is not fully selected", () => {
    const keys = collapseSelectionToGroups(brass, ["0-0"]);
    expect(keys).toEqual(["0-0"]);
  });
});

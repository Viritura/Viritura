import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { extractFamilyGroups, buildPartGroups, type PartRef } from "../familyGroups";

/** Minimal score carrying only part names (all classification needs). */
function scoreWithParts(names: string[]): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: names.map((name, i) => ({ id: `p${i}`, name, measures: [] })),
  } as unknown as Score;
}

const refs = (n: number): PartRef[] => Array.from({ length: n }, (_, i) => ({ index: i }));

describe("extractFamilyGroups — classify all parts by name", () => {
  it("groups an orchestral score by instrument family (no Other dumping)", () => {
    const names = ["Flute", "Oboe", "Horn in F", "Trumpet in B♭", "Timpani", "Piano", "Violin I", "Cello"];
    const groups = extractFamilyGroups(scoreWithParts(names), refs(names.length));
    const byLabel = new Map(groups.map((g) => [g.label, g.partIndices]));
    expect(byLabel.get("Woodwinds")).toEqual([0, 1]); // Flute, Oboe
    expect(byLabel.get("Brass")).toEqual([2, 3]); // Horn, Trumpet
    expect(byLabel.get("Percussion")).toEqual([4]); // Timpani
    expect(byLabel.get("Keys")).toEqual([5]); // Piano
    expect(byLabel.get("Strings")).toEqual([6, 7]); // Violin, Cello
    // Crucially: nothing falls into "Other".
    expect(byLabel.has("Other")).toBe(false);
  });

  it("places Piano under Keys (not its own labelled brace group)", () => {
    const groups = extractFamilyGroups(scoreWithParts(["Piano", "Violin I"]), refs(2));
    const keys = groups.find((g) => g.label === "Keys");
    expect(keys?.partIndices).toEqual([0]);
  });

  it("emits families in canonical orchestral order", () => {
    // Provide them out of order; expect WW → Brass → Perc → Keys → Strings.
    const names = ["Violin I", "Piano", "Trumpet in B♭", "Flute", "Timpani"];
    const groups = extractFamilyGroups(scoreWithParts(names), refs(names.length));
    expect(groups.map((g) => g.label)).toEqual(["Woodwinds", "Brass", "Percussion", "Keys", "Strings"]);
  });

  it("prefers a PartRef's resolved display name over the raw score name", () => {
    const score = scoreWithParts(["", ""]); // raw names empty
    const parts: PartRef[] = [
      { index: 0, name: "Flute 1" },
      { index: 1, name: "Trombone 2" },
    ];
    const groups = extractFamilyGroups(score, parts);
    const byLabel = new Map(groups.map((g) => [g.label, g.partIndices]));
    expect(byLabel.get("Woodwinds")).toEqual([0]);
    expect(byLabel.get("Brass")).toEqual([1]);
  });

  it("buckets unclassifiable parts under Other (and only those)", () => {
    const groups = extractFamilyGroups(scoreWithParts(["Flute", "Kazoo"]), refs(2));
    const byLabel = new Map(groups.map((g) => [g.label, g.partIndices]));
    expect(byLabel.get("Woodwinds")).toEqual([0]);
    expect(byLabel.get("Other")).toEqual([1]);
  });

  it("returns a single All Parts group when there is no score", () => {
    const groups = extractFamilyGroups(null, refs(3));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("All Parts");
    expect(groups[0]!.partIndices).toEqual([0, 1, 2]);
  });

  it("buildPartGroups maps each part index to its family label", () => {
    const names = ["Flute", "Trumpet in B♭", "Piano"];
    const groups = extractFamilyGroups(scoreWithParts(names), refs(names.length));
    expect(buildPartGroups(names.length, groups)).toEqual(["Woodwinds", "Brass", "Keys"]);
  });
});

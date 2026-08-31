import { describe, it, expect } from "vitest";
import type { Part } from "@viritura/core";
import { kitComponentFromStaffPosition, kitComponentsAtStaffPosition } from "../kitInput";

/** A kit where two instruments share staff position 3 (snare + side-stick),
 *  mirroring real imports (e.g. Rhapsody in Blue). Order in the dict is the
 *  cycle order. */
function makePart(): Part {
  return {
    name: "Percussion",
    kit: {
      "kit-crash": { staffPosition: 6, name: "Crash", sound: "s1", notehead: "x" },
      "kit-snare": { staffPosition: 3, name: "Snare", sound: "s2" },
      "kit-stick": { staffPosition: 3, name: "Side Stick", sound: "s3", notehead: "x" },
      "kit-bass": { staffPosition: -1, name: "Bass", sound: "s4" },
    },
    measures: [],
  } as unknown as Part;
}

describe("kitComponentsAtStaffPosition", () => {
  it("returns every component sharing the nearest line, in dict order", () => {
    const part = makePart();
    // Exactly on the shared line.
    expect(kitComponentsAtStaffPosition(part, 3)).toEqual(["kit-snare", "kit-stick"]);
    // Slightly off but still nearest to line 3.
    expect(kitComponentsAtStaffPosition(part, 2)).toEqual(["kit-snare", "kit-stick"]);
  });

  it("returns a single id for a line with one instrument", () => {
    const part = makePart();
    expect(kitComponentsAtStaffPosition(part, 6)).toEqual(["kit-crash"]);
    expect(kitComponentsAtStaffPosition(part, -1)).toEqual(["kit-bass"]);
  });

  it("first element matches the single nearest-pick (cycle starts there)", () => {
    const part = makePart();
    const nearest = kitComponentFromStaffPosition(part, 3);
    expect(kitComponentsAtStaffPosition(part, 3)[0]).toBe(nearest);
  });

  it("cycles deterministically: snare → side-stick → snare", () => {
    const part = makePart();
    const sharing = kitComponentsAtStaffPosition(part, 3);
    const next = (cur: string) => sharing[(sharing.indexOf(cur) + 1) % sharing.length];
    expect(next("kit-snare")).toBe("kit-stick");
    expect(next("kit-stick")).toBe("kit-snare");
  });

  it("returns [] for a part with no kit", () => {
    const part = { name: "Violin", measures: [] } as unknown as Part;
    expect(kitComponentsAtStaffPosition(part, 0)).toEqual([]);
  });
});

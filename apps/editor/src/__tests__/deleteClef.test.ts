import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { deleteClefByElementId } from "../keyboard/normalModeDeleteHelpers";

const G = { sign: "G", staffPosition: -2 } as const;
const F = { sign: "F", staffPosition: 2 } as const;

/** Two-measure part: m0 establishes treble, m1 changes to bass. */
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }, { id: "m1" }] },
    parts: [
      {
        name: "Cello",
        measures: [
          {
            clefs: [{ clef: { ...G } }],
            sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }],
          },
          {
            clefs: [{ clef: { ...F } }],
            sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
    ],
  };
}

describe("deleteClefByElementId", () => {
  it("removes a clef change, reverting to the inherited clef", () => {
    const out = deleteClefByElementId(makeScore(), "p0/m1/clef");
    expect(out).not.toBeNull();
    expect(out!.parts[0]!.measures[1]!.clefs).toBeUndefined();
    // The establishing clef is untouched.
    expect(out!.parts[0]!.measures[0]!.clefs).toEqual([{ clef: G }]);
  });

  it("refuses to delete the part's establishing clef (m0)", () => {
    expect(deleteClefByElementId(makeScore(), "p0/m0/clef")).toBeNull();
  });

  it("is a no-op on a measure with no clef of its own (running clef)", () => {
    const score = makeScore();
    delete score.parts[0]!.measures[1]!.clefs;
    expect(deleteClefByElementId(score, "p0/m1/clef")).toBeNull();
  });

  it("returns null for malformed or non-clef ids", () => {
    expect(deleteClefByElementId(makeScore(), "p0/m1/key")).toBeNull();
    expect(deleteClefByElementId(makeScore(), "p9/m1/clef")).toBeNull();
    expect(deleteClefByElementId(makeScore(), "garbage")).toBeNull();
  });
});

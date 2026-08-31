import { describe, expect, it } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { resolveTwoNoteTremoloSelection } from "../components/palette";

function note(id: string): NoteEvent {
  return { type: "event", id, duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] };
}

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0", time: { count: 4, unit: 4 } }] },
    parts: [{ name: "Piano", measures: [{ sequences: [{ content: [note("a"), note("b"), note("c")] }] }] }],
  };
}

describe("resolveTwoNoteTremoloSelection", () => {
  it("resolves only the two notehead endpoints of a range", () => {
    const locations = resolveTwoNoteTremoloSelection(
      { kind: "range", startElementId: "p0/m0/s0/a/n0", endElementId: "p0/m0/s0/c/n0" },
      makeScore(),
    );
    expect(locations.map((location) => location.eventIndex)).toEqual([0, 2]);
  });

  it("keeps canonical multi-selection resolution", () => {
    const locations = resolveTwoNoteTremoloSelection(
      { kind: "multi", elementIds: ["p0/m0/s0/b/n0", "p0/m0/s0/a/n0"] },
      makeScore(),
    );
    expect(locations.map((location) => location.eventIndex)).toEqual([0, 1]);
  });
});

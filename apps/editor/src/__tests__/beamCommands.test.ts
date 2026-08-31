import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  beamTogetherSelection,
  breakBeamAfterSelection,
  canBeamTogetherSelection,
  canBreakBeamAfterSelection,
} from "../commands/beamCommands";
import type { Selection } from "../store/selectionStore";

function score(time = { count: 4, unit: 4 }): Score {
  const events = Array.from({ length: 8 }, (_, index) => ({
    type: "event" as const,
    id: `e${index + 1}`,
    duration: { base: "eighth" as const },
    notes: [{ id: `n${index + 1}`, pitch: { step: "C" as const, octave: 4 as const } }],
  }));
  return {
    mnx: { version: 1 },
    global: { measures: [{ time }] },
    parts: [{ id: "p1", measures: [{ sequences: [{ content: events }] }] }],
  };
}

function range(start: string, end: string): Selection {
  return { kind: "range", startElementId: `p0/m0/s0/${start}`, endElementId: `p0/m0/s0/${end}` };
}

function single(id: string): Selection {
  return { kind: "single", elementId: `p0/m0/s0/${id}`, elementType: "event" };
}

describe("breakBeamAfterSelection", () => {
  it("materializes automatic groups and splits after the range endpoint", () => {
    const value = score();

    expect(breakBeamAfterSelection(value, range("e1", "e2"))).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams).toEqual([
      { events: ["e1", "e2"] },
      { events: ["e3", "e4"] },
      { events: ["e5", "e6", "e7", "e8"] },
    ]);
  });

  describe("beamTogetherSelection", () => {
    it("creates an explicit beam over a selected consecutive note range", () => {
      const value = score();

      expect(canBeamTogetherSelection(value, range("e2", "e4"))).toBe(true);
      expect(beamTogetherSelection(value, range("e2", "e4"))).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e2", "e3", "e4"] }]);
    });

    it("replaces the selected portion of an existing beam and preserves the rest", () => {
      const value = score();
      value.parts[0]!.measures[0]!.beams = [{ events: ["e1", "e2", "e3", "e4"] }, { events: ["e5", "e6"] }];

      expect(beamTogetherSelection(value, range("e2", "e3"))).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e5", "e6"] }, { events: ["e2", "e3"] }]);
    });

    it("retains contiguous runs on either side of the new beam", () => {
      const value = score();
      value.parts[0]!.measures[0]!.beams = [{ events: ["e1", "e2", "e3", "e4", "e5", "e6"] }];

      expect(beamTogetherSelection(value, range("e3", "e4"))).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([
        { events: ["e1", "e2"] },
        { events: ["e5", "e6"] },
        { events: ["e3", "e4"] },
      ]);
    });

    it("requires a contiguous range of at least two beamable note events", () => {
      const value = score();

      expect(canBeamTogetherSelection(value, single("e1"))).toBe(false);
      expect(beamTogetherSelection(value, single("e1"))).toBe(false);
    });
  });

  it("uses document order for a backwards range", () => {
    const value = score();

    expect(breakBeamAfterSelection(value, range("e2", "e1"))).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams?.[0]?.events).toEqual(["e1", "e2"]);
  });

  it("preserves unrelated explicit beam groups", () => {
    const value = score();
    value.parts[0]!.measures[0]!.beams = [{ events: ["e1", "e2", "e3", "e4"] }, { events: ["e5", "e6", "e7", "e8"] }];

    expect(breakBeamAfterSelection(value, single("e2"))).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams).toEqual([
      { events: ["e1", "e2"] },
      { events: ["e3", "e4"] },
      { events: ["e5", "e6", "e7", "e8"] },
    ]);
  });

  it("writes an empty beam list when breaking a two-note group", () => {
    const value = score({ count: 2, unit: 4 });
    value.parts[0]!.measures[0]!.sequences[0]!.content.splice(4);

    expect(breakBeamAfterSelection(value, single("e1"))).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e3", "e4"] }]);

    expect(breakBeamAfterSelection(value, single("e3"))).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams).toEqual([]);
  });

  it("does nothing when the note is already at a beam boundary", () => {
    const value = score();

    expect(canBreakBeamAfterSelection(value, single("e4"))).toBe(false);
    expect(breakBeamAfterSelection(value, single("e4"))).toBe(false);
    expect(value.parts[0]!.measures[0]!.beams).toBeUndefined();
  });

  it("disables the action when explicit beam mode guarantees a no-op", () => {
    const value = score();
    value.mnx.support = { useBeams: true };

    expect(canBreakBeamAfterSelection(value, single("e2"))).toBe(false);
  });

  it("splits a cross-barline beam stored on the preceding measure", () => {
    const value = score();
    const secondMeasureEvents = value.parts[0]!.measures[0]!.sequences[0]!.content.splice(4);
    value.global.measures.push({});
    value.parts[0]!.measures.push({ sequences: [{ content: secondMeasureEvents }] });
    value.parts[0]!.measures[0]!.beams = [{ events: ["e3", "e4", "e5", "e6"] }];

    const selection: Selection = {
      kind: "single",
      elementId: "p0/m1/s0/e5",
      elementType: "event",
    };
    expect(breakBeamAfterSelection(value, selection)).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e3", "e4", "e5"] }]);
    expect(value.parts[0]!.measures[1]!.beams).toBeUndefined();
  });
});

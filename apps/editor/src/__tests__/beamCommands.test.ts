import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  beamTogetherSelection,
  breakBeamAfterAtLevel,
  breakBeamAfterSelection,
  canBreakBeamAfterAtLevel,
  canBeamTogetherSelection,
  canBreakBeamAfterSelection,
  canJoinBeamAtLevel,
  canSetBeamletDirection,
  joinBeamAtLevel,
  setBeamletDirection,
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

function multi(...ids: string[]): Selection {
  return { kind: "multi", elementIds: ids.map((id) => `p0/m0/s0/${id}`) };
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

  describe("recursive beam editing", () => {
    function flaggedScore(base: "16th" | "32nd" = "16th"): Score {
      const value = score();
      for (const item of value.parts[0]!.measures[0]!.sequences[0]!.content) {
        if (item.type === "event") item.duration = { base };
      }
      return value;
    }

    it("materializes an implicit primary and preserves inferred sibling inner groups when joining", () => {
      const value = flaggedScore();

      expect(canJoinBeamAtLevel(value, range("e2", "e3"), 2)).toBe(true);
      expect(joinBeamAtLevel(value, range("e2", "e3"), 2)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([
        {
          events: ["e1", "e2", "e3", "e4"],
          beams: [
            { events: ["e1"], direction: "auto" },
            { events: ["e2", "e3"] },
            { events: ["e4"], direction: "auto" },
          ],
        },
        { events: ["e5", "e6", "e7", "e8"] },
      ]);
    });

    it("splits a secondary beam and retains the primary beam", () => {
      const value = flaggedScore();

      expect(canBreakBeamAfterAtLevel(value, single("e2"), 2)).toBe(true);
      expect(breakBeamAfterAtLevel(value, single("e2"), 2)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]).toEqual({
        events: ["e1", "e2", "e3", "e4"],
        beams: [{ events: ["e1", "e2"] }, { events: ["e3", "e4"] }],
      });
    });

    it("edits tertiary groups under the correct secondary parent", () => {
      const value = flaggedScore("32nd");
      value.parts[0]!.measures[0]!.beams = [
        {
          events: ["e1", "e2", "e3", "e4"],
          beams: [{ events: ["e1", "e2"] }, { events: ["e3", "e4"] }],
        },
      ];

      expect(joinBeamAtLevel(value, range("e1", "e2"), 3)).toBe(false);
      expect(breakBeamAfterAtLevel(value, single("e1"), 3)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams?.[0]).toEqual({
        events: ["e1", "e2"],
        beams: [
          { events: ["e1"], direction: "auto" },
          { events: ["e2"], direction: "auto" },
        ],
      });
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams?.[1]).toEqual({ events: ["e3", "e4"] });
    });

    it("authors and restores directed beamlets without losing descendants or siblings", () => {
      const value = flaggedScore("32nd");
      value.parts[0]!.measures[0]!.beams = [
        {
          events: ["e1", "e2", "e3", "e4"],
          beams: [{ events: ["e1", "e2", "e3", "e4"], beams: [{ events: ["e2"], direction: "left" }] }],
        },
      ];

      expect(canSetBeamletDirection(value, single("e2"), 2, "right")).toBe(true);
      expect(setBeamletDirection(value, single("e2"), 2, "right")).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams).toEqual([
        { events: ["e1"], direction: "auto" },
        { events: ["e2"], beams: [{ events: ["e2"], direction: "left" }], direction: "right" },
        { events: ["e3", "e4"] },
      ]);
      expect(canSetBeamletDirection(value, single("e2"), 2, "right")).toBe(false);
      expect(setBeamletDirection(value, single("e2"), 2, "auto")).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams?.[1]?.direction).toBe("auto");
      expect(setBeamletDirection(value, single("e2"), 2, "left")).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams?.[1]?.direction).toBe("left");
      expect(setBeamletDirection(value, single("e2"), 2, null)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams).toEqual([
        { events: ["e1", "e2", "e3", "e4"], beams: [{ events: ["e2"], direction: "left" }] },
      ]);
    });

    it("rejects ineligible, non-contiguous, and cross-parent inner joins", () => {
      const value = flaggedScore();
      const first = value.parts[0]!.measures[0]!.sequences[0]!.content[1];
      if (first?.type === "event") first.duration = { base: "eighth" };
      expect(canJoinBeamAtLevel(value, range("e1", "e2"), 2)).toBe(false);
      expect(joinBeamAtLevel(value, multi("e1", "e3"), 2)).toBe(false);

      const explicit = flaggedScore();
      explicit.parts[0]!.measures[0]!.beams = [{ events: ["e1", "e2"] }, { events: ["e3", "e4"] }];
      expect(joinBeamAtLevel(explicit, range("e2", "e3"), 2)).toBe(false);
    });

    it("does not infer a primary group when explicit beam mode is enabled", () => {
      const value = flaggedScore();
      value.mnx.support = { useBeams: true };

      expect(canJoinBeamAtLevel(value, range("e1", "e2"), 2)).toBe(false);
      expect(joinBeamAtLevel(value, range("e1", "e2"), 2)).toBe(false);
      expect(value.parts[0]!.measures[0]!.beams).toBeUndefined();

      value.parts[0]!.measures[0]!.beams = [{ events: ["e1", "e2", "e3", "e4"] }];
      expect(joinBeamAtLevel(value, range("e2", "e3"), 2)).toBe(true);
    });

    it("splits an inner beam stored on a preceding measure", () => {
      const value = flaggedScore();
      const later = value.parts[0]!.measures[0]!.sequences[0]!.content.splice(4);
      value.global.measures.push({});
      value.parts[0]!.measures.push({ sequences: [{ content: later }] });
      value.parts[0]!.measures[0]!.beams = [
        {
          events: ["e3", "e4", "e5", "e6"],
          beams: [{ events: ["e3", "e4", "e5", "e6"] }],
        },
      ];
      const selection: Selection = {
        kind: "single",
        elementId: "p0/m1/s0/e5",
        elementType: "event",
      };

      expect(breakBeamAfterAtLevel(value, selection, 2)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams).toEqual([
        { events: ["e3", "e4", "e5"] },
        { events: ["e6"], direction: "auto" },
      ]);
      expect(value.parts[0]!.measures[1]!.beams).toBeUndefined();
    });

    it("writes recursive beam edits through a condensed projection", () => {
      const value = flaggedScore();
      const secondPart = structuredClone(value.parts[0]!);
      secondPart.id = "p2";
      for (const item of secondPart.measures[0]!.sequences[0]!.content) {
        if (item.type === "event") {
          item.id = `second-${item.id}`;
          if (item.notes?.[0]) item.notes[0].id = `second-${item.notes[0].id}`;
        }
      }
      value.parts[0]!.id = "p1";
      value.parts.push(secondPart);
      value.layouts = [
        {
          id: "condensed",
          content: [{ type: "staff", sources: [{ part: "p1" }, { part: "p2" }] }],
        },
      ];
      value.scores = [{ name: "Condensed", layout: "condensed" }];

      expect(joinBeamAtLevel(value, range("e2", "e3"), 2, 0)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams?.[0]?.beams?.[1]?.events).toEqual(["e2", "e3"]);
      expect(value.parts[1]!.measures[0]!.beams?.[0]?.beams?.[1]?.events).toEqual(["second-e2", "second-e3"]);
    });

    it("preserves nested beams when joining a subset at the primary level", () => {
      const value = flaggedScore("32nd");
      value.parts[0]!.measures[0]!.beams = [
        {
          events: ["e1", "e2", "e3", "e4"],
          beams: [
            {
              events: ["e1", "e2", "e3", "e4"],
              beams: [{ events: ["e2"], direction: "left" }],
            },
          ],
        },
      ];

      expect(joinBeamAtLevel(value, range("e2", "e3"), 1)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([
        {
          events: ["e2", "e3"],
          beams: [{ events: ["e2", "e3"], beams: [{ events: ["e2"], direction: "left" }] }],
        },
      ]);
    });

    it("removes selected events from a cross-measure primary owner before joining them", () => {
      const value = flaggedScore();
      const later = value.parts[0]!.measures[0]!.sequences[0]!.content.splice(4);
      value.global.measures.push({});
      value.parts[0]!.measures.push({ sequences: [{ content: later }] });
      value.parts[0]!.measures[0]!.beams = [{ events: ["e3", "e4", "e5", "e6"] }];
      const selection: Selection = {
        kind: "range",
        startElementId: "p0/m1/s0/e5",
        endElementId: "p0/m1/s0/e6",
      };

      expect(joinBeamAtLevel(value, selection, 1)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e3", "e4"] }]);
      expect(value.parts[0]!.measures[1]!.beams).toEqual([{ events: ["e5", "e6"] }]);
    });
  });

  describe("beamTogetherSelection", () => {
    it("creates an explicit beam over a selected consecutive note range", () => {
      const value = score();

      expect(canBeamTogetherSelection(value, range("e2", "e4"))).toBe(true);
      expect(beamTogetherSelection(value, range("e2", "e4"))).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e2", "e3", "e4"] }]);
    });

    it("creates an explicit beam over consecutive Ctrl+click selections", () => {
      const value = score();
      const selection = multi("e4", "e2", "e3");

      expect(canBeamTogetherSelection(value, selection)).toBe(true);
      expect(beamTogetherSelection(value, selection)).toBe(true);
      expect(value.parts[0]!.measures[0]!.beams).toEqual([{ events: ["e2", "e3", "e4"] }]);
    });

    it("rejects non-contiguous Ctrl+click selections", () => {
      const value = score();
      const selection = multi("e2", "e4");

      expect(canBeamTogetherSelection(value, selection)).toBe(false);
      expect(beamTogetherSelection(value, selection)).toBe(false);
      expect(value.parts[0]!.measures[0]!.beams).toBeUndefined();
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

  it("materializes and splits an implicit group beside an explicit group", () => {
    const value = score();
    value.parts[0]!.measures[0]!.beams = [{ events: ["e1", "e2", "e3", "e4"] }];

    expect(canBreakBeamAfterSelection(value, single("e6"))).toBe(true);
    expect(breakBeamAfterSelection(value, single("e6"))).toBe(true);
    expect(value.parts[0]!.measures[0]!.beams).toEqual([
      { events: ["e1", "e2", "e3", "e4"] },
      { events: ["e5", "e6"] },
      { events: ["e7", "e8"] },
    ]);
  });

  it("materializes implicit groups when the explicit beam list is empty", () => {
    const value = score();
    value.parts[0]!.measures[0]!.beams = [];

    expect(canBreakBeamAfterSelection(value, single("e2"))).toBe(true);
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

import { describe, it, expect } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import { findSlurAnchorInfo, reanchoredSlurElementId, reanchorSlurInScore } from "../slurAnchorMutations";

function note(id: string, slurs?: NoteEvent["slurs"]): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ pitch: { step: "C", octave: 4 } }],
    ...(slurs ? { slurs } : {}),
  };
}

/** One part, one measure: e1 slurs to e2; e3 and a grace note are free targets. */
function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  note("e0"),
                  note("e1", [{ target: "e2", startNote: "n0", shape: { p0: [1, 1], p2: [0, -2] } }]),
                  note("e2"),
                  note("e3"),
                  { type: "grace", content: [note("g1")] },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

function slursOf(score: Score, eventId: string): NoteEvent["slurs"] {
  const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
  for (const item of content) {
    if (item.type === "event" && item.id === eventId) return item.slurs;
    if (item.type === "grace") {
      for (const g of item.content) if (g.type === "event" && g.id === eventId) return g.slurs;
    }
  }
  return undefined;
}

describe("findSlurAnchorInfo", () => {
  it("resolves the owning part and both endpoints", () => {
    expect(findSlurAnchorInfo(makeScore(), "slur/e1/e2")).toEqual({
      partIndex: 0,
      sourceEventId: "e1",
      targetEventId: "e2",
    });
  });

  it("returns null for a non-slur id or an unknown slur", () => {
    const score = makeScore();
    expect(findSlurAnchorInfo(score, "p0/m0/s0/e1")).toBeNull();
    expect(findSlurAnchorInfo(score, "slur/e1/e9")).toBeNull();
  });
});

describe("reanchoredSlurElementId", () => {
  it("rewrites the endpoint represented by the slur element id", () => {
    const score = makeScore();
    expect(reanchoredSlurElementId(score, "slur/e1/e2", "start", "e0")).toBe("slur/e0/e2");
    expect(reanchoredSlurElementId(score, "slur/e1/e2", "end", "e3")).toBe("slur/e1/e3");
  });

  it("returns the normalized id when a dragged endpoint crosses the other", () => {
    const score = makeScore();
    expect(reanchoredSlurElementId(score, "slur/e1/e2", "end", "e0")).toBe("slur/e0/e1");
    expect(reanchoredSlurElementId(score, "slur/e1/e2", "start", "e3")).toBe("slur/e2/e3");
  });

  it("returns null for a non-slur id", () => {
    expect(reanchoredSlurElementId(makeScore(), "p0/m0/s0/e1", "end", "e3")).toBeNull();
  });
});

describe("reanchorSlurInScore", () => {
  it("repoints the target when the end handle moves", () => {
    const next = reanchorSlurInScore(makeScore(), "slur/e1/e2", "end", "e3");
    expect(slursOf(next, "e1")).toEqual([{ target: "e3", startNote: "n0", shape: { p0: [1, 1], p2: [0, -2] } }]);
  });

  it("moves the slur onto the new source event when the start handle moves", () => {
    const next = reanchorSlurInScore(makeScore(), "slur/e1/e2", "start", "e0");
    expect(slursOf(next, "e1")).toBeUndefined();
    expect(slursOf(next, "e0")).toEqual([{ target: "e2", shape: { p2: [0, -2] } }]);
  });

  it("can re-anchor onto a grace note while keeping endpoints chronological", () => {
    const next = reanchorSlurInScore(makeScore(), "slur/e1/e2", "start", "g1");
    expect(slursOf(next, "e2")).toEqual([{ target: "g1", shape: { p1: [0, -2] } }]);
  });

  it("drops the shape override for the endpoint that moved", () => {
    const score = makeScore();
    const withP3 = reanchorSlurInScore(score, "slur/e1/e2", "end", "e3");
    expect(slursOf(withP3, "e1")![0]!.shape).toEqual({ p0: [1, 1], p2: [0, -2] });

    const moved = reanchorSlurInScore(score, "slur/e1/e2", "start", "e0");
    expect(slursOf(moved, "e0")![0]!.shape).toEqual({ p2: [0, -2] });
  });

  it("reverses endpoint metadata when the end crosses before the start", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content[1]!.slurs = [
      {
        target: "e2",
        startNote: "start-note",
        endNote: "end-note",
        side: "up",
        sideEnd: "down",
        shape: { p0: [1, 1], p1: [2, 2], p2: [3, 3], p3: [4, 4] },
      },
    ];

    const next = reanchorSlurInScore(score, "slur/e1/e2", "end", "e0");

    expect(slursOf(next, "e1")).toBeUndefined();
    expect(slursOf(next, "e0")).toEqual([
      {
        target: "e1",
        endNote: "start-note",
        side: "down",
        sideEnd: "up",
        shape: { p1: [3, 3], p2: [2, 2], p3: [1, 1] },
      },
    ]);
  });

  it("reverses endpoint metadata when the start crosses after the end", () => {
    const score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0]!.content[1]!.slurs = [
      {
        target: "e2",
        startNote: "start-note",
        endNote: "end-note",
        side: "up",
        sideEnd: "down",
        shape: { p0: [1, 1], p1: [2, 2], p2: [3, 3], p3: [4, 4] },
      },
    ];

    const next = reanchorSlurInScore(score, "slur/e1/e2", "start", "e3");

    expect(slursOf(next, "e1")).toBeUndefined();
    expect(slursOf(next, "e2")).toEqual([
      {
        target: "e3",
        startNote: "end-note",
        side: "down",
        sideEnd: "up",
        shape: { p0: [4, 4], p1: [3, 3], p2: [2, 2] },
      },
    ]);
  });

  it("refuses moves that would collapse the slur onto one event", () => {
    const score = makeScore();
    expect(reanchorSlurInScore(score, "slur/e1/e2", "end", "e1")).toBe(score);
    expect(reanchorSlurInScore(score, "slur/e1/e2", "start", "e2")).toBe(score);
  });

  it("returns the original score for an unresolvable id", () => {
    const score = makeScore();
    expect(reanchorSlurInScore(score, "not-a-slur", "end", "e3")).toBe(score);
    expect(reanchorSlurInScore(score, "slur/e9/e2", "end", "e3")).toBe(score);
  });
});

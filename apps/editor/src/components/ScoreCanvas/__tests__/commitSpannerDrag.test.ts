import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import type { SpannerHandleHit } from "@viritura/renderer";
import { commitSpannerDragImpl, type SpannerDragSnap } from "../commitSpannerDrag";

const HAIRPIN_GROUP_ID = "0195f3a1-7c4e-7a2b-9d10-1f2e3a4b5c6d";

/** One part, two measures, with a single gradual (hairpin) dynamic group. */
function makeHairpinScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [{ content: [] }],
            dynamics: [
              {
                id: HAIRPIN_GROUP_ID,
                type: "gradual",
                value: "cresc",
                position: { fraction: [0, 16] },
                end: { measure: "m0", position: { fraction: [8, 16] } },
              },
            ],
          },
          { sequences: [{ content: [] }] },
        ],
      },
    ],
  } as unknown as Score;
}

const SNAPS: SpannerDragSnap[] = [
  { x: 0, beat: 0, measureIndex: 0 },
  { x: 100, beat: 1, measureIndex: 0 },
  { x: 200, beat: 2, measureIndex: 0 },
  { x: 300, beat: 3, measureIndex: 0 },
];

function hit(elementId: string, handle: "start" | "end"): SpannerHandleHit {
  return { elementId, handle, handleX: 0, handleY: 0 };
}

function hairpinOf(score: Score) {
  return score.parts[0]!.measures[0]!.dynamics![0]!;
}

describe("commitSpannerDragImpl — hairpin group ids", () => {
  it("moves the end handle of a hairpin identified by its group id", () => {
    const score = makeHairpinScore();
    const next = commitSpannerDragImpl(score, hit(`p0/m0/hairpin${HAIRPIN_GROUP_ID}`, "end"), 300, SNAPS);

    expect(next).not.toBe(score);
    expect(hairpinOf(next).end!.position.fraction).toEqual([12, 16]);
  });

  it("moves the start handle of a hairpin identified by its group id", () => {
    const score = makeHairpinScore();
    const next = commitSpannerDragImpl(score, hit(`p0/m0/hairpin${HAIRPIN_GROUP_ID}`, "start"), 200, SNAPS);

    expect(next).not.toBe(score);
    expect(hairpinOf(next).position.fraction).toEqual([8, 16]);
  });

  it("leaves the score untouched when the group id does not resolve", () => {
    const score = makeHairpinScore();
    const next = commitSpannerDragImpl(score, hit("p0/m0/hairpinnot-a-real-group", "end"), 300, SNAPS);

    expect(hairpinOf(next).end!.position.fraction).toEqual([8, 16]);
  });

  it("returns the original score when there are no snap points", () => {
    const score = makeHairpinScore();
    expect(commitSpannerDragImpl(score, hit(`p0/m0/hairpin${HAIRPIN_GROUP_ID}`, "end"), 300, [])).toBe(score);
  });
});

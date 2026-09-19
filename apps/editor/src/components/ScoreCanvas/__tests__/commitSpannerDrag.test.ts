import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import type { SpannerHandleHit } from "@viritura/renderer";
import { commitSpannerDragImpl, resolveTrillLineDragTarget, type SpannerDragSnap } from "../commitSpannerDrag";

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

function makeOttavaScore(): Score {
  const score = makeHairpinScore();
  return {
    ...score,
    parts: [
      {
        ...score.parts[0]!,
        measures: [
          {
            ...score.parts[0]!.measures[0]!,
            ottavas: [
              {
                value: 3,
                position: { fraction: [0, 16] },
                end: { measure: "m0", position: { fraction: [8, 16] } },
              },
            ],
          },
          score.parts[0]!.measures[1]!,
        ],
      },
    ],
  };
}

function makeTrillExtensionScore(): Score {
  const score = makeHairpinScore();
  score.parts[0]!.measures[0]!.sequences = [
    {
      content: [
        {
          type: "event",
          id: "ev1",
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "C", octave: 4 } }],
          markings: { trill: { extension: { target: "ev2" } } },
        },
        {
          type: "event",
          id: "ev2",
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "D", octave: 4 } }],
        },
        {
          type: "event",
          id: "ev3",
          duration: { base: "half" },
          notes: [{ pitch: { step: "E", octave: 4 } }],
        },
      ],
    },
  ];
  return score;
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

  it("moves a selected ottava endpoint to the visible snap position", () => {
    const score = makeOttavaScore();
    const next = commitSpannerDragImpl(score, hit("p0/m0/ottava0", "end"), 300, SNAPS);

    expect(next.parts[0]!.measures[0]!.ottavas![0]!.end.position.fraction).toEqual([12, 16]);
  });

  it("reanchors a trill extension end handle to the nearest note event", () => {
    const score = makeTrillExtensionScore();
    const anchors: SpannerDragSnap[] = [
      { x: 150, y: 50, eventId: "ev1", targetEdge: "end", measureIndex: 0 },
      { x: 200, y: 50, eventId: "ev2", targetEdge: "start", measureIndex: 0 },
      { x: 300, y: 50, eventId: "ev3", targetEdge: "end", measureIndex: 0 },
    ];

    const next = commitSpannerDragImpl(score, hit("trill-line/ev1/ev2", "end"), 295, anchors, 52);
    const event = next.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

    expect(event.type === "event" ? event.markings?.trill?.extension?.target : undefined).toBe("ev3");
    expect(event.type === "event" ? event.markings?.trill?.extension?.targetEdge : undefined).toBe("end");
    expect(resolveTrillLineDragTarget(hit("trill-line/ev1/ev2", "end"), 295, anchors, 52)).toEqual({
      eventId: "ev3",
      targetEdge: "end",
      elementId: "trill-line/ev1/ev3",
    });
  });

  it("does not move the fixed start of a trill extension", () => {
    const score = makeTrillExtensionScore();
    const anchors: SpannerDragSnap[] = [{ x: 300, y: 50, eventId: "ev3", targetEdge: "end", measureIndex: 0 }];

    expect(commitSpannerDragImpl(score, hit("trill-line/ev1/ev2", "start"), 300, anchors, 50)).toBe(score);
  });
});

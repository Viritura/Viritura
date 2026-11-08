import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { SpatialIndex, type MeasureBounds, type SpannerHandleHit } from "@viritura/renderer";
import { commitSpannerDragImpl } from "../commitSpannerDrag";
import { buildEndingDragSnaps, planEndingDrag } from "../endingDrag";
import { prepareSpannerDrag, updateSpannerDrag } from "../spannerDragSetup";
import type { SpannerDragState } from "../paintScoreFrame";
import { computeDeleteSelection } from "../../../commands/computeDeleteSelection";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        { time: { count: 3, unit: 4 } },
        { ending: { duration: 3, numbers: [2], open: true, color: "#123456" } },
        { time: { count: 6, unit: 8 } },
        { repeatEnd: {} },
        {},
        {},
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: Array.from({ length: 6 }, (_, index) => ({
          sequences: [
            {
              content: [
                {
                  type: "event",
                  id: `ev${index}`,
                  duration: { base: "whole" },
                  rest: {},
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}

function bounds(index: number, x = index * 100, y = 50): MeasureBounds {
  return {
    index,
    x,
    y,
    width: 100,
    height: 40,
    partIndex: 0,
    partId: "piano",
    staffIndex: 0,
    prefixWidth: 20,
    totalBeats: 3,
    beatAnchors: [
      [0, x + 20],
      [3, x + 100],
    ],
  };
}

function hit(handle: "start" | "end", elementId = "m1/volta"): SpannerHandleHit {
  return { elementId, handle, handleX: 100, handleY: 30 };
}

function snaps(handle: "start" | "end") {
  return buildEndingDragSnaps(
    Array.from({ length: 6 }, (_, index) => bounds(index)),
    handle,
  );
}

describe("ending drag handles", () => {
  it.each([
    { handle: "start" as const, x: 0, start: 0, duration: 4 },
    { handle: "start" as const, x: 200, start: 2, duration: 2 },
    { handle: "end" as const, x: 300, start: 1, duration: 2 },
    { handle: "end" as const, x: 600, start: 1, duration: 5 },
    { handle: "start" as const, x: 500, start: 3, duration: 1 },
    { handle: "end" as const, x: 100, start: 1, duration: 1 },
  ])("moves $handle to $x, keeping the opposite endpoint and metadata", ({ handle, x, start, duration }) => {
    const score = makeScore();
    const original = structuredClone(score);
    const next = commitSpannerDragImpl(score, hit(handle), x, snaps(handle), 30);
    const expected = structuredClone(original);
    delete expected.global.measures[1]!.ending;
    expected.global.measures[start]!.ending = { ...original.global.measures[1]!.ending!, duration };

    expect(next).toEqual(expected);
    expect(score).toEqual(original);
    expect(planEndingDrag(score, hit(handle), x, snaps(handle), 30)).toMatchObject({
      kind: "move",
      elementId: `m${start}/volta`,
    });
  });

  it("keeps the relocated bracket deletable through its new selection identity", () => {
    const score = makeScore();
    const plan = planEndingDrag(score, hit("start"), 200, snaps("start"), 30);
    expect(plan.kind).toBe("move");
    if (plan.kind !== "move") return;
    const moved = commitSpannerDragImpl(score, hit("start"), 200, snaps("start"), 30);
    const deleted = computeDeleteSelection(moved, {
      kind: "single",
      elementId: plan.elementId,
      elementType: "volta",
    });
    expect(deleted.kind).toBe("single");
    if (deleted.kind !== "single") return;
    expect(deleted.score.global.measures.every((measure) => measure.ending === undefined)).toBe(true);
    expect(deleted.score.parts).toEqual(score.parts);
  });

  it.each(["start", "end"] as const)("leaves an unchanged %s endpoint untouched", (handle) => {
    const score = makeScore();
    const x = handle === "start" ? 100 : 400;
    expect(commitSpannerDragImpl(score, hit(handle), x, snaps(handle), 30)).toBe(score);
  });

  it.each([
    { handle: "start" as const, otherStart: 0, otherDuration: 1, x: 0 },
    { handle: "end" as const, otherStart: 4, otherDuration: 2, x: 600 },
  ])(
    "rejects overlapping $handle moves without overwriting another ending",
    ({ handle, otherStart, otherDuration, x }) => {
      const score = makeScore();
      score.global.measures[otherStart]!.ending = { duration: otherDuration, numbers: [1] };
      const original = structuredClone(score);

      expect(planEndingDrag(score, hit(handle), x, snaps(handle), 30)).toEqual({
        kind: "error",
        error: "Ending brackets cannot overlap. Move the other ending first.",
      });
      expect(commitSpannerDragImpl(score, hit(handle), x, snaps(handle), 30)).toBe(score);
      expect(score).toEqual(original);
    },
  );

  it("allows adjacent endings to share a barline", () => {
    const score = makeScore();
    score.global.measures[4]!.ending = { duration: 2, numbers: [3] };
    const next = commitSpannerDragImpl(score, hit("end"), 300, snaps("end"), 30);
    expect(next.global.measures[1]!.ending?.duration).toBe(2);
    expect(next.global.measures[4]!.ending).toEqual(score.global.measures[4]!.ending);
  });

  it("chooses the pointer's system instead of the first measure at the same x", () => {
    const score = makeScore();
    const anchors = buildEndingDragSnaps([bounds(0, 0, 50), bounds(4, 0, 300)], "end");
    const next = commitSpannerDragImpl(score, hit("end"), 100, anchors, 280);
    expect(next.global.measures[1]!.ending?.duration).toBe(4);
  });

  it("does not commit missing endings or out-of-score snap points", () => {
    const score = makeScore();
    expect(commitSpannerDragImpl(score, hit("end", "m0/volta"), 500, snaps("end"))).toBe(score);
    expect(commitSpannerDragImpl(score, hit("end"), 500, [{ x: 500, measureIndex: 99, targetEdge: "end" }])).toBe(
      score,
    );
    expect(commitSpannerDragImpl(score, hit("end"), 500, [])).toBe(score);
  });

  it("uses left/right barlines rather than note anchors and ignores hidden staff copies", () => {
    const visible = bounds(1, 100, 50);
    const copies = [
      { ...visible, y: 0, ghostStaff: true },
      { ...visible, y: 10, isExpansion: true },
      { ...visible, y: 20, isHidden: true },
      { ...visible, y: 150, partIndex: 1, staffIndex: 1 },
      visible,
    ];
    expect(buildEndingDragSnaps(copies, "start")).toEqual([{ x: 100, y: 50, measureIndex: 1, targetEdge: "start" }]);
    expect(buildEndingDragSnaps(copies, "end")).toEqual([{ x: 200, y: 50, measureIndex: 1, targetEdge: "end" }]);
  });

  it("keeps measure snapping when Alt changes during dragging", () => {
    const buildRhythmicSnaps = vi.fn(() => []);
    const setup = prepareSpannerDrag({
      score: makeScore(),
      spatialIndex: new SpatialIndex([]),
      measureBounds: [bounds(1)],
      elementId: "m1/volta",
      handle: "end",
      altKey: false,
      buildRhythmicSnaps,
    });
    const drag: SpannerDragState = {
      hit: hit("end"),
      dragX: 0,
      dragY: 0,
      bbox: { x: 100, y: 30, width: 300, height: 20 },
      snapPoints: setup.snapPoints,
      altKey: false,
    };
    updateSpannerDrag(
      drag,
      new PointerEvent("pointermove", { clientX: 220, clientY: 70, altKey: true }),
      new DOMRect(20, 10),
      { zoom: 2, scrollX: 10, scrollY: 20 },
      setup,
      buildRhythmicSnaps,
    );
    expect(drag.dragX).toBe(110);
    expect(drag.dragY).toBe(50);
    expect(drag.snapPoints).toEqual([{ x: 200, y: 50, measureIndex: 1, targetEdge: "end" }]);
    expect(buildRhythmicSnaps).not.toHaveBeenCalled();
  });
});

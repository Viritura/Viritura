import { describe, expect, it } from "vitest";
import { textContentFromPlain, type Score, type TextFrame } from "@viritura/core";
import {
  addTextFrameInScore,
  applyScoreDefChanges,
  buildTextFrame,
  deleteTextFrameInScore,
  measureLocatorAt,
  moveTextFrameInScore,
  nextTextFrameId,
  reorderTextFrameInScore,
  resizeTextFrameInScore,
  setTextFrameContentInScore,
  textFrameLocatorMeasureIndex,
  textFrameLocatorResolvesInView,
  textFramesForScore,
} from "../ScoreMutations";

function frame(id: string, overrides: Partial<TextFrame> = {}): TextFrame {
  return {
    id,
    locator: { type: "page", pageIndex: 0 },
    placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
    width: { unit: "staffSpaces", value: 20 },
    content: textContentFromPlain(id),
    ...overrides,
  };
}

function scoreWith(frames: TextFrame[] = [], partFrames: TextFrame[] = []): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1" }, { id: "m2" }, {}] },
    parts: [
      {
        id: "P1",
        name: "Violin",
        measures: [
          { sequences: [{ content: [{ type: "event", id: "e1", duration: { base: "whole" } }] }] },
          {
            sequences: [
              {
                content: [
                  {
                    type: "tuplet",
                    inner: { multiple: 3, duration: { base: "quarter" } },
                    outer: { multiple: 2, duration: { base: "quarter" } },
                    content: [{ type: "event", id: "e2", duration: { base: "quarter" } }],
                  },
                ],
              },
            ],
          },
          { sequences: [{ content: [] }] },
        ],
      },
    ],
    scores: [
      { name: "Full", layout: "full", ...(frames.length ? { textFrames: frames } : {}) },
      { name: "Violin", layout: "violin", ...(partFrames.length ? { textFrames: partFrames } : {}) },
    ],
  } as Score;
}

const ids = (score: Score, index = 0) => textFramesForScore(score, index).map((f) => f.id);

describe("text frame mutations", () => {
  it("adds frames on top and scopes them to one score view", () => {
    const next = addTextFrameInScore(scoreWith([frame("a")]), 0, frame("b"));
    expect(ids(next)).toEqual(["a", "b"]);
    expect(next.scores?.[1]?.textFrames).toBeUndefined();
  });

  it("rejects an ID already used by any score view", () => {
    const score = scoreWith([], [frame("a")]);
    expect(addTextFrameInScore(score, 0, frame("a"))).toBe(score);
  });

  it("allocates IDs unique across all score views", () => {
    const score = scoreWith([frame("tf1")], [frame("tf2")]);
    expect(nextTextFrameId(score)).toBe("tf3");
    expect(buildTextFrame(score, { locator: { type: "page", pageIndex: 1 } })).toMatchObject({
      id: "tf3",
      locator: { type: "page", pageIndex: 1 },
      placement: { anchor: "top-left", offset: { x: 0, y: 0 } },
      width: { unit: "staffSpaces", value: 20 },
      content: [{ text: "Text" }],
    });
  });

  it("edits content while keeping authored line breaks", () => {
    const next = setTextFrameContentInScore(scoreWith([frame("a")]), 0, "a", textContentFromPlain("one\ntwo"));
    expect(textFramesForScore(next, 0)[0]!.content).toEqual([{ text: "one\ntwo" }]);
  });

  it("moves by a staff-space delta relative to the page anchor", () => {
    const score = scoreWith([frame("a", { placement: { anchor: "bottom-right", offset: { x: 1, y: 2 } } })]);
    const next = moveTextFrameInScore(score, 0, "a", { x: -3, y: 0.5 });
    expect(textFramesForScore(next, 0)[0]!.placement).toEqual({ anchor: "bottom-right", offset: { x: -2, y: 2.5 } });
    expect(moveTextFrameInScore(score, 0, "a", { x: 0, y: 0 })).toBe(score);
  });

  it("clamps widths to each unit's valid range", () => {
    const score = scoreWith([frame("a")]);
    const tooNarrow = resizeTextFrameInScore(score, 0, "a", { unit: "staffSpaces", value: -4 });
    expect(textFramesForScore(tooNarrow, 0)[0]!.width).toEqual({ unit: "staffSpaces", value: 1 });
    const tooWide = resizeTextFrameInScore(score, 0, "a", { unit: "textColumnFraction", value: 1.5 });
    expect(textFramesForScore(tooWide, 0)[0]!.width).toEqual({ unit: "textColumnFraction", value: 1 });
  });

  it("deletes frames and drops the empty collection", () => {
    const score = scoreWith([frame("a"), frame("b")]);
    const one = deleteTextFrameInScore(score, 0, "a");
    expect(ids(one)).toEqual(["b"]);
    const none = deleteTextFrameInScore(one, 0, "b");
    expect(none.scores?.[0]).not.toHaveProperty("textFrames");
    expect(deleteTextFrameInScore(score, 0, "missing")).toBe(score);
  });

  it("reorders paint layers", () => {
    const score = scoreWith([frame("a"), frame("b"), frame("c")]);
    expect(ids(reorderTextFrameInScore(score, 0, "a", "forward"))).toEqual(["b", "a", "c"]);
    expect(ids(reorderTextFrameInScore(score, 0, "c", "backward"))).toEqual(["a", "c", "b"]);
    expect(ids(reorderTextFrameInScore(score, 0, "a", "front"))).toEqual(["b", "c", "a"]);
    expect(ids(reorderTextFrameInScore(score, 0, "c", "back"))).toEqual(["c", "a", "b"]);
    expect(reorderTextFrameInScore(score, 0, "c", "front")).toBe(score);
    expect(reorderTextFrameInScore(score, 0, "a", "backward")).toBe(score);
  });

  it("resolves musical locators through authored IDs only", () => {
    const score = scoreWith();
    expect(textFrameLocatorMeasureIndex(score, { type: "globalMeasure", measureId: "m2" })).toBe(1);
    expect(textFrameLocatorMeasureIndex(score, { type: "globalMeasure", measureId: "m3" })).toBeNull();
    expect(textFrameLocatorMeasureIndex(score, { type: "event", partId: "P1", eventId: "e2" })).toBe(1);
    expect(textFrameLocatorMeasureIndex(score, { type: "event", partId: "P1", eventId: "gone" })).toBeNull();
    expect(textFrameLocatorMeasureIndex(score, { type: "page", pageIndex: 0 })).toBeNull();
    expect(measureLocatorAt(score, 0)).toEqual({ type: "globalMeasure", measureId: "m1" });
    expect(measureLocatorAt(score, 2)).toBeNull();
    expect(measureLocatorAt(score, 9)).toBeNull();
  });

  it("treats targets missing from a score view as unresolved", () => {
    const score: Score = {
      ...scoreWith(),
      layouts: [
        { id: "full", content: [{ type: "staff", sources: [{ part: "P1" }] }] },
        { id: "violin", content: [] },
      ],
    };
    const event = { type: "event", partId: "P1", eventId: "e1" } as const;
    expect(textFrameLocatorResolvesInView(score, 0, event)).toBe(true);
    expect(textFrameLocatorResolvesInView(score, 1, event)).toBe(false);
    expect(textFrameLocatorResolvesInView(score, 0, { type: "globalMeasure", measureId: "gone" })).toBe(false);
    expect(textFrameLocatorResolvesInView(score, 1, { type: "page", pageIndex: 7 })).toBe(true);
  });

  it("keeps frames when score definitions are edited", () => {
    const score = scoreWith([frame("a")]);
    const next = applyScoreDefChanges(score, [
      { name: "Renamed", layoutId: "full" },
      { name: "Violin", layoutId: "violin" },
    ]);
    expect(ids(next)).toEqual(["a"]);
  });
});

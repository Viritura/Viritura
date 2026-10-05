import { describe, expect, it } from "vitest";
import type { Score, TextExpression } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { pageTextToStaff, staffTextToPage, TextAttachmentError } from "./index";

function fixture(width = false): Score {
  const expression: TextExpression = {
    text: [{ text: "Instructions\n", style: { weight: "bold" } }, { glyphs: ["dynamicPP"] }],
    position: { fraction: [1, 4] },
    placement: "below",
    staff: 2,
    voice: "v1",
    manualOffset: [2, 3],
    avoidCollisions: false,
    frame: {
      border: "solid",
      padding: 1,
      eraseBackground: true,
      paragraphJustification: "center",
      ...(width ? { width: { unit: "staffSpaces", value: 12 } } : {}),
    },
  };
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        staves: 2,
        measures: [
          {
            sequences: [{ content: [{ type: "event", duration: { base: "whole" }, rest: {} }] }],
            expressions: [expression],
          },
        ],
      },
    ],
    scores: [{ name: "Full" }, { name: "Part" }],
  };
}

describe("Staff/Page text attachment switching", () => {
  it("materializes the implicit full-score view without inventing layout geometry", () => {
    const score = fixture();
    delete score.scores;
    const result = staffTextToPage(score, 0, 0, 0, 0);
    expect(result.score.scores).toHaveLength(1);
    expect(result.score.scores![0]!.name).toBe("Full score");
    expect(result.score.scores![0]!.layout).toBeUndefined();
    expect(result.score.scores![0]!.textFrames).toHaveLength(1);
    expect(score.scores).toBeUndefined();
    expect(
      pageTextToStaff(parseMnx(serializeMnx(result.score)), 0, result.frameId).score.parts[0]!.measures[0]!.expressions,
    ).toHaveLength(1);
  });
  it.each([false, true])(
    "moves text atomically into the active view and restores staff settings through save/reload (fixed width=%s)",
    (fixed) => {
      const score = fixture(fixed);
      const result = staffTextToPage(score, 1, 0, 0, 0);
      const page = result.score.scores![1]!.textFrames![0]!;
      expect(score.parts[0]!.measures[0]!.expressions).toHaveLength(1);
      expect(result.score.parts[0]!.measures[0]!.expressions).toBeUndefined();
      expect(result.score.scores![0]!.textFrames).toBeUndefined();
      expect(page.placement).toEqual({ anchor: "top-left", offset: { x: 0, y: 0 } });
      expect(page.width).toEqual({ unit: "staffSpaces", value: fixed ? 12 : 20 });
      expect(page.locator).toEqual({ type: "globalMeasure", measureId: result.score.global.measures[0]!.id });
      expect(page.content[0]).toEqual({ text: "Instructions\n", style: { weight: "bold", fontStyle: "italic" } });
      page.placement = { anchor: "bottom", offset: { x: -4, y: 5 } };
      page.width = { unit: "textColumnFraction", value: 0.8 };
      page.content = [...page.content, { text: "Edited on page", style: { fontStyle: "normal" } }];
      const reloaded = parseMnx(serializeMnx(result.score));
      const restored = pageTextToStaff(reloaded, 1, result.frameId);
      const staff = restored.score.parts[0]!.measures[0]!.expressions![0]!;
      expect(restored.elementId).toBe("p0/m0/expr0");
      expect(staff.position).toEqual({ fraction: [1, 4] });
      expect(staff.manualOffset).toEqual([2, 3]);
      expect(staff.avoidCollisions).toBe(false);
      expect(staff.staff).toBe(2);
      expect(staff.voice).toBe("v1");
      expect(staff.frame?.width).toEqual(fixed ? { unit: "staffSpaces", value: 12 } : undefined);
      expect(staff.frame).toMatchObject({ border: "solid", padding: 1, eraseBackground: true });
      expect(staff.text).toEqual(page.content);
      expect(restored.score.scores![1]!.textFrames).toBeUndefined();
      const switchedAgain = staffTextToPage(parseMnx(serializeMnx(restored.score)), 1, 0, 0, 0);
      const returnedPage = switchedAgain.score.scores![1]!.textFrames![0]!;
      expect(returnedPage.id).toBe(page.id);
      expect(returnedPage.placement).toEqual(page.placement);
      expect(returnedPage.width).toEqual(page.width);
    },
  );

  it("requires an explicit destination if the original part, measure, or staff is missing", () => {
    const { score, frameId } = staffTextToPage(fixture(), 0, 0, 0, 0);
    score.parts[0]!.staves = 1;
    expect(() => pageTextToStaff(score, 0, frameId)).toThrow(TextAttachmentError);
    const restored = pageTextToStaff(score, 0, frameId, {
      partIndex: 0,
      measureIndex: 0,
      expression: { position: { fraction: [0, 1] }, staff: 1, placement: "above" },
    });

    expect(restored.score.parts[0]!.measures[0]!.expressions![0]!.staff).toBe(1);
    expect(() =>
      pageTextToStaff(score, 0, frameId, {
        partIndex: 8,
        measureIndex: 0,
        expression: { position: { fraction: [0, 1] } },
      }),
    ).toThrow(TextAttachmentError);
  });

  it("remembers page paint order and avoids a reused dormant frame ID", () => {
    const { score, frameId } = staffTextToPage(fixture(), 0, 0, 0, 0);
    const page = score.scores![0]!.textFrames![0]!;
    score.scores![0]!.textFrames!.push({ ...page, id: "other" });
    const restored = pageTextToStaff(score, 0, frameId);
    const reloaded = parseMnx(serializeMnx(restored.score));
    const again = staffTextToPage(reloaded, 0, 0, 0, 0);
    expect(again.score.scores![0]!.textFrames!.map((frame) => frame.id)).toEqual([frameId, "other"]);
    reloaded.scores![0]!.textFrames!.push({ ...page, id: frameId });
    const collision = staffTextToPage(reloaded, 0, 0, 0, 0);
    expect(collision.frameId).not.toBe(frameId);
    expect(collision.score.scores![0]!.textFrames!.map((frame) => frame.id)).toEqual([
      collision.frameId,
      "other",
      frameId,
    ]);
  });

  it("restores the original attachment by IDs after parts and measures are reordered", () => {
    const { score, frameId } = staffTextToPage(fixture(), 0, 0, 0, 0);
    score.parts.unshift({
      id: "another",
      measures: [{ sequences: [{ content: [] }] }, { sequences: [{ content: [] }] }],
    });
    score.global.measures.unshift({ id: "new-first" });
    score.parts[1]!.measures.unshift({ sequences: [{ content: [] }] });
    const restored = pageTextToStaff(score, 0, frameId);
    expect(restored.elementId).toBe("p1/m1/expr0");
    expect(restored.score.parts[1]!.measures[1]!.expressions![0]!.position.fraction).toEqual([1, 4]);
  });
});

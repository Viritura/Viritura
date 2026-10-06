import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  getAnnotationOffset,
  isMovableAnnotationId,
  resetAnnotationPlacementInScore,
  setAnnotationAvoidCollisionsInScore,
  setAnnotationOffsetAxisInScore,
} from "../annotationOffsetMutations";

describe("system-text placement mutations", () => {
  it("supports manual offsets and collision intent by stable system-text ID", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            systemText: [{ id: "note-1", text: [{ text: "See note" }], position: { fraction: [0, 1] } }],
          },
        ],
      },
      parts: [],
    };
    const id = "m0/systemText/note-1";

    expect(isMovableAnnotationId(id)).toBe(true);
    expect(getAnnotationOffset(score, id)).toEqual([0, 0]);
    const positioned = setAnnotationOffsetAxisInScore(score, id, 0, 2.5);
    const pinned = setAnnotationAvoidCollisionsInScore(positioned, id, false);
    expect(pinned.global.measures[0]!.systemText![0]).toMatchObject({
      manualOffset: [2.5, 0],
      avoidCollisions: false,
    });

    const reset = resetAnnotationPlacementInScore(pinned, id);
    expect(reset.global.measures[0]!.systemText![0]).not.toHaveProperty("manualOffset");
    expect(reset.global.measures[0]!.systemText![0]).not.toHaveProperty("avoidCollisions");
  });
});

import { describe, expect, it } from "vitest";
import type { DisplayList, PatchInfo } from "@viritura/renderer";
import { PerfTracker, SpatialIndex } from "@viritura/renderer";
import { runFastLayoutAndPaint } from "../components/ScoreCanvas/fastLayout";

function displayList(changedX: number): DisplayList {
  return {
    commands: [],
    width: 400,
    height: 200,
    measureBounds: [
      {
        index: 0,
        partIndex: 0,
        staffIndex: 0,
        x: 0,
        y: 0,
        width: 180,
        height: 100,
        prefixWidth: 0,
        totalBeats: 4,
        beatAnchors: [],
      },
      {
        index: 1,
        partIndex: 0,
        staffIndex: 0,
        x: 200,
        y: 0,
        width: 180,
        height: 100,
        prefixWidth: 0,
        totalBeats: 4,
        beatAnchors: [],
      },
    ],
    elementBboxes: [
      { elementId: "p0/m0/e0", bbox: { x: changedX, y: 30, width: 10, height: 10 } },
      { elementId: "p0/m1/e1", bbox: { x: 250, y: 30, width: 10, height: 10 } },
    ],
  };
}

const patchInfo: PatchInfo = {
  changedGlobalMeasures: [],
  changedPartMeasures: new Map([[0, [0]]]),
  structuralChange: false,
};

async function publishIndex(before: DisplayList, after: DisplayList, previous = SpatialIndex.fromDisplayList(before)) {
  const spatialIndexRef = { current: previous };
  await runFastLayoutAndPaint({
    json: "",
    patchInfo,
    computeDisplayList: async () => after,
    displayListRef: { current: before },
    displayListVersionRef: { current: 0 },
    spatialIndexRef,
    docScoreRef: { current: null },
    paintNowRef: { current: () => {} },
    perfTracker: new PerfTracker(),
  });
  return spatialIndexRef.current;
}

describe("fast-layout hit-index publication", () => {
  it("replaces the dirty measure while preserving clean targets", async () => {
    const before = displayList(40);
    const after = displayList(70);
    const previous = SpatialIndex.fromDisplayList(before);
    const updated = await publishIndex(before, after, previous);

    expect(updated.all.find((entry) => entry.id === "p0/m0/e0")?.x).toBe(70);
    expect(updated.all.find((entry) => entry.id === "p0/m1/e1")?.x).toBe(250);
    expect(updated.size).toBe(2);
  });

  it("builds hit targets from authoritative bboxes", async () => {
    const after = displayList(70);
    const updated = await publishIndex(after, after);
    expect(updated.size).toBe(2);
  });

  it("updates reflowed targets outside the edited measure", async () => {
    const before = displayList(40);
    before.measureBounds![1]!.x = 700;
    before.elementBboxes![1]!.bbox.x = 750;
    const after = structuredClone(before);
    after.measureBounds![1]!.x = 900;
    after.elementBboxes![1]!.bbox.x = 950;
    const previous = SpatialIndex.fromDisplayList(before);
    const updated = await publishIndex(before, after, previous);

    expect(updated.hitTest(955, 35)).toBe("p0/m1/e1");
    expect(updated.hitTest(755, 35)).toBeNull();
    expect(updated.all).toEqual(SpatialIndex.fromDisplayList(after).all);
  });

  it("removes old hit targets when a retained frame is updated in place", async () => {
    const retained = displayList(40);
    const previous = SpatialIndex.fromDisplayList(retained);
    retained.measureBounds![0]!.x = 700;
    retained.elementBboxes![0]!.bbox.x = 750;
    const updated = await publishIndex(retained, retained, previous);

    expect(updated.hitTest(755, 35)).toBe("p0/m0/e0");
    expect(updated.hitTest(45, 35)).toBeNull();
    expect(updated.all).toEqual(SpatialIndex.fromDisplayList(retained).all);
  });
});

import { describe, expect, it } from "vitest";
import type { DisplayList, PatchInfo } from "@viritura/renderer";
import { SpatialIndex } from "@viritura/renderer";
import { updateEnrichedSpatialIndexForPatch } from "../store/enrichSpatialIndex";

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

describe("updateEnrichedSpatialIndexForPatch", () => {
  it("replaces the dirty measure while retaining clean entries", () => {
    const before = displayList(40);
    const after = displayList(70);
    const previous = SpatialIndex.fromDisplayList(before);
    const updated = updateEnrichedSpatialIndexForPatch(previous, before, after, null, patchInfo);

    expect(updated.all.find((entry) => entry.id === "p0/m0/e0")?.x).toBe(70);
    expect(updated.all.find((entry) => entry.id === "p0/m1/e1")?.x).toBe(250);
    expect(updated.size).toBe(2);
  });

  it("falls back safely without patch metadata", () => {
    const after = displayList(70);
    const updated = updateEnrichedSpatialIndexForPatch(null, null, after, null);
    expect(updated.size).toBe(2);
  });
});

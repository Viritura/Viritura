import { describe, expect, it } from "vitest";
import { hitTestBeamInk, selectionGroupMembers } from "../beamHitTest";
import type { DisplayList } from "../wasm";

const displayList: DisplayList = {
  width: 300,
  height: 200,
  commands: [
    {
      type: "DrawLine",
      x1: 100,
      y1: 40,
      x2: 100,
      y2: 120,
      width: 2,
      color: "#000",
    },
    {
      type: "DrawPolygon",
      points: [
        [80, 40],
        [180, 50],
        [180, 56],
        [80, 46],
      ],
      color: "#000",
    },
  ],
  elementIds: ["p0/m0/s0/a", "p0/m0/beam0"],
  selectionGroups: [{ elementId: "p0/m0/beam0", memberIds: ["p0/m0/s0/a", "p0/m0/s0/b"] }],
};

describe("hitTestBeamInk", () => {
  it("hits the filled beam polygon ahead of overlapping event geometry", () => {
    expect(hitTestBeamInk(displayList, 100, 45)).toBe("p0/m0/beam0");
  });

  it("allows only a narrow tolerance around beam ink", () => {
    expect(hitTestBeamInk(displayList, 130, 52.5)).toBe("p0/m0/beam0");
    expect(hitTestBeamInk(displayList, 130, 65)).toBeNull();
  });

  it("ignores non-polygon commands even if they overlap", () => {
    expect(hitTestBeamInk(displayList, 100, 100)).toBeNull();
  });
});

describe("selectionGroupMembers", () => {
  it("returns exact beam members", () => {
    expect(selectionGroupMembers(displayList, "p0/m0/beam0")).toEqual(["p0/m0/s0/a", "p0/m0/s0/b"]);
  });
});

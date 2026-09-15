import { describe, expect, it } from "vitest";
import { selectionAnnouncement } from "./selectionAnnouncement";

describe("selectionAnnouncement", () => {
  it("describes an empty selection", () => {
    expect(selectionAnnouncement({ kind: "none" })).toBe("No score selection.");
  });

  it("describes a typed single selection", () => {
    expect(
      selectionAnnouncement({
        kind: "single",
        elementId: "p0/m0/s0/e0",
        elementType: "event",
      }),
    ).toBe("Selected event.");
  });

  it("counts multi and measure selections", () => {
    expect(selectionAnnouncement({ kind: "multi", elementIds: ["a", "b"] })).toBe("2 score elements selected.");
    expect(
      selectionAnnouncement({
        kind: "measure",
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 1,
        endStaffIndex: 2,
        startMeasure: 2,
        endMeasure: 4,
      }),
    ).toBe("3 measures selected across 2 staves.");
  });
});

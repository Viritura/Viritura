import { describe, expect, it } from "vitest";
import type { DisplayList } from "@viritura/renderer";
import { buildTrackSystems, trackBeatToX } from "./trackGeometry";
import { chordTrackScale, scaleTrackSystem, trackLaneY, trackBottomInset } from "./trackViewport";

const displayList: DisplayList = {
  commands: [],
  width: 1000,
  height: 600,
  measureBounds: [
    {
      index: 0,
      partIndex: 0,
      partId: "piano",
      staffIndex: 0,
      systemIndex: 0,
      x: 100,
      y: 140,
      width: 600,
      height: 96,
      prefixWidth: 80,
      totalBeats: 4,
      beatAnchors: [
        [0, 180],
        [1, 310],
        [4, 700],
      ],
    },
  ],
};

describe("chord track score-space scaling", () => {
  it.each([
    { bottom: 12, sticky: true, overlay: 56, expected: 12 },
    { bottom: 66, sticky: true, overlay: 56, expected: 12 },
    { bottom: 106, sticky: true, overlay: 56, expected: 50 },
    { bottom: 66, sticky: false, overlay: 56, expected: 66 },
    { bottom: 24, sticky: true, overlay: 0, expected: 24 },
  ])("excludes only the overlaid status zone from the sticky bottom inset", ({ bottom, sticky, overlay, expected }) => {
    expect(trackBottomInset(bottom, sticky, overlay)).toBe(expected);
  });
  it.each([
    [100, 76, 600, 12, 24, 100],
    [-100, 76, 600, 12, 24, 12],
    [900, 76, 600, 12, 24, 500],
    [900, 152, 600, 12, 24, 424],
    [900, 76, 400, 12, 24, 300],
  ])(
    "keeps the natural lane or pins it inside the safe viewport (%s)",
    (natural, height, viewportHeight, top, bottom, expected) => {
      expect(trackLaneY(natural, height, viewportHeight, true, top, bottom)).toBe(expected);
    },
  );

  it("does not pin when disabled or before the viewport is measured", () => {
    expect(trackLaneY(900, 76, 600, false, 12, 24)).toBe(900);
    expect(trackLaneY(-100, 76, 600, false, 12, 24)).toBe(-100);
    expect(trackLaneY(900, 76, 0, true)).toBe(900);
  });

  it("scales lane typography to the engine's staff size, independent of device pixel ratio", () => {
    expect(chordTrackScale(displayList)).toBe(2);
    expect(
      chordTrackScale({ ...displayList, measureBounds: [{ ...displayList.measureBounds![0]!, height: 48 }] }),
    ).toBe(1);
  });

  it("normalizes painter coordinates without changing musical alignment", () => {
    const scale = chordTrackScale(displayList);
    const system = buildTrackSystems(displayList)[0]!;
    const painted = scaleTrackSystem(system, 1 / scale);
    for (const beat of [0, 0.5, 1, 2, 3]) {
      expect(trackBeatToX(painted.measures[0]!, beat) * scale).toBe(trackBeatToX(system.measures[0]!, beat));
    }
  });
});

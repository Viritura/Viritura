import { describe, expect, it } from "vitest";
import type { DisplayList } from "@viritura/renderer";
import { buildTrackSystems, trackBeatToX } from "./trackGeometry";
import { chordTrackScale, scaleTrackSystem } from "./trackViewport";

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

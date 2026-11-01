import { describe, expect, it } from "vitest";
import { parseChordSymbolText } from "@viritura/core";
import type { DisplayList, MeasureBounds } from "@viritura/renderer";
import { buildTrackPoints, buildTrackSystems, pointChord, trackBeatToX } from "./trackGeometry";

const measure: MeasureBounds = {
  index: 0,
  partIndex: 0,
  partId: "melody",
  staffIndex: 0,
  systemIndex: 0,
  x: 100,
  y: 140,
  width: 300,
  height: 48,
  prefixWidth: 40,
  totalBeats: 4,
  beatAnchors: [
    [0, 140],
    [0.5, 185],
    [1, 210],
    [2, 320],
    [4, 400],
  ],
};

describe("shared chord-track geometry", () => {
  it("aligns ticks to actual event anchors and interpolates unequal spacing", () => {
    expect(trackBeatToX(measure, 0.5)).toBe(185);
    expect(trackBeatToX(measure, 1)).toBe(210);
    expect(trackBeatToX(measure, 1.5)).toBe(265);
    expect(trackBeatToX(measure, 4)).toBe(400);
  });

  it("uses one shared lane per system, excluding hidden and expansion staffs", () => {
    const displayList: DisplayList = {
      commands: [],
      width: 1000,
      height: 900,
      measureBounds: [
        measure,
        { ...measure, partIndex: 1, staffIndex: 1, y: 250 },
        { ...measure, partIndex: 2, ghostStaff: true, y: 1000 },
        { ...measure, partIndex: 3, isExpansion: true, y: 1000 },
        { ...measure, partIndex: 4, isHidden: true, y: 1000 },
        { ...measure, index: 1, systemIndex: 1, y: 600 },
      ],
    };
    const systems = buildTrackSystems(displayList);
    expect(systems).toHaveLength(2);
    expect(systems[0]!.measures).toHaveLength(1);
    expect(systems[0]!.sourceTop).toBe(80);
    expect(systems[0]!.musicHeight).toBe(278);
    expect(systems[1]!.measures[0]!.index).toBe(1);
  });

  it("retains editable off-grid chords and does not duplicate a measure-end tick", () => {
    const system = buildTrackSystems({ commands: [], width: 1000, height: 300, measureBounds: [measure] })[0]!;
    const chord = { measureIndex: 0, symbol: parseChordSymbolText("Dm7", { fraction: [3, 8] }) };
    const points = buildTrackPoints(system, 1, [chord]);
    expect(points.map((point) => point.beat)).toEqual([0, 1, 1.5, 2, 3]);
    expect(pointChord([chord], points[2]!)).toBe(chord);
    expect(buildTrackPoints(system, 0.25)).toHaveLength(16);
  });

  it("uses lower-staff rhythmic anchors when the upper staff is silent", () => {
    const system = buildTrackSystems({
      commands: [],
      width: 1000,
      height: 400,
      measureBounds: [
        {
          ...measure,
          beatAnchors: [
            [0, 140],
            [4, 400],
          ],
        },
        { ...measure, partIndex: 1, staffIndex: 1, y: 250 },
      ],
    })[0]!;
    expect(trackBeatToX(system.measures[0]!, 1.5)).toBe(265);
    expect(system.measures[0]!.partIndex).toBe(0);
  });

  it("uses nonempty staff timing without dividing by an empty free-meter staff duration", () => {
    const system = buildTrackSystems({
      commands: [],
      width: 1000,
      height: 400,
      measureBounds: [
        { ...measure, totalBeats: 0, beatAnchors: [] },
        { ...measure, partIndex: 1, staffIndex: 1, y: 250 },
        { ...measure, partIndex: 2, staffIndex: 2, totalBeats: 0, beatAnchors: [] },
      ],
    })[0]!;
    expect(system.measures[0]!.totalBeats).toBe(4);
    expect(trackBeatToX(system.measures[0]!, 1.5)).toBe(265);
    expect(trackBeatToX({ ...measure, totalBeats: 0, beatAnchors: [] }, 0)).toBe(140);
  });
});

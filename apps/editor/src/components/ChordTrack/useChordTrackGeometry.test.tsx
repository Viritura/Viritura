// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { useChordTrackGeometry } from "./useChordTrackGeometry";
import { trackBeatToX } from "./trackGeometry";

afterEach(cleanup);

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 6, unit: 8 } }] },
  parts: [],
};
const displayList: DisplayList = {
  commands: [],
  width: 500,
  height: 240,
  measureBounds: [
    {
      index: 0,
      partIndex: 0,
      staffIndex: 0,
      x: 100,
      y: 100,
      width: 300,
      height: 48,
      prefixWidth: 20,
      totalBeats: 3,
      beatAnchors: [
        [0, 120],
        [1, 180],
        [2, 310],
        [3, 400],
      ],
    },
  ],
};

describe("chord entry and drag grid geometry", () => {
  it("uses quarter notes rather than compound beats and supplies sixteenth anchors for Alt", () => {
    const { result } = renderHook(() =>
      useChordTrackGeometry({
        displayList,
        score,
        chords: [],
        grid: "quarter",
        viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
        safeAreaLeft: 0,
        selection: { kind: "none" },
        hover: null,
        size: { width: 500, height: 400 },
      }),
    );
    expect(result.current.allPoints.map((point) => point.beat)).toEqual([0, 1, 2]);
    expect(result.current.beatPoints.map((point) => point.beat)).toEqual([0, 1.5]);
    expect(result.current.finePoints.map((point) => point.beat)).toEqual([
      0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75,
    ]);
    expect(result.current.finePoints[5]!.x).toBe(trackBeatToX(displayList.measureBounds![0]!, 1.25));
    expect(result.current.finePoints[5]!.x).toBe(212.5);
  });
});

// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { computeHorizonPaperGeometry, type DisplayList } from "@viritura/renderer";
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
  it("reserves the hover status zone without moving the pinned lane when the status bar opens", () => {
    const { result, rerender } = renderHook(
      ({ safeAreaBottom }) =>
        useChordTrackGeometry({
          displayList,
          score,
          chords: [],
          grid: "quarter",
          sticky: true,
          position: "below",
          viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
          safeAreaLeft: 0,
          safeAreaTop: 12,
          safeAreaBottom,
          selection: { kind: "none" },
          hover: null,
          size: { width: 500, height: 200, bottomOverlay: 56 },
        }),
      { initialProps: { safeAreaBottom: 12 } },
    );
    expect(result.current.bottomInset).toBe(68);
    expect(result.current.railY).toBe(56);
    rerender({ safeAreaBottom: 66 });
    expect(result.current.bottomInset).toBe(68);
    expect(result.current.railY).toBe(56);
  });

  it.each(["above", "below"] as const)(
    "keeps paint and hit geometry aligned while pinning the %s lane vertically",
    (position) => {
      const { result, rerender } = renderHook(
        ({ scrollY, zoom, sticky }) =>
          useChordTrackGeometry({
            displayList,
            score,
            chords: [],
            grid: "quarter",
            sticky,
            position,
            viewport: { zoom, scrollX: 20, scrollY },
            safeAreaLeft: 0,
            safeAreaTop: 12,
            safeAreaBottom: 24,
            selection: { kind: "none" },
            hover: null,
            size: { width: 500, height: 200 },
          }),
        { initialProps: { scrollY: 0, zoom: 1, sticky: true } },
      );
      const paper = computeHorizonPaperGeometry(displayList);
      const natural = position === "above" ? paper.y - 88 : paper.y + paper.height + 12;
      expect(result.current.naturalRailScoreY).toBe(natural);
      expect(result.current.railY).toBe(position === "above" ? 12 : 100);
      expect(result.current.surfaceStyle.top).toBe(result.current.railY);
      expect(result.current.surfaceStyle.height).toBe(76);
      rerender({ scrollY: 900, zoom: 1, sticky: true });
      expect(result.current.railY).toBe(12);
      expect(result.current.railScoreY - 900).toBe(result.current.railY);
      expect(result.current.allPoints[1]!.x).toBe(180);
      rerender({ scrollY: 0, zoom: 2, sticky: true });
      expect(result.current.railY).toBe(position === "above" ? 12 : 24);
      expect(result.current.railScoreY * 2).toBe(result.current.railY);
      rerender({ scrollY: 900, zoom: 2, sticky: false });
      expect(result.current.railY).toBe((natural - 900) * 2);
      expect(result.current.laneVisible).toBe(false);
    },
  );

  it("uses quarter notes rather than compound beats and supplies sixteenth anchors for Alt", () => {
    const { result } = renderHook(() =>
      useChordTrackGeometry({
        displayList,
        score,
        chords: [],
        grid: "quarter",
        sticky: true,
        position: "below",
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

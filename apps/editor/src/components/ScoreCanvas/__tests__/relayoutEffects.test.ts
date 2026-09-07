import { afterEach, describe, expect, it, vi } from "vitest";
import { PerfTracker, type DisplayList, type ScoreInfo, type SpatialIndex } from "@viritura/renderer";

import { runFastLayoutAndPaint } from "../fastLayout";
import { runSecondaryRelayout } from "../relayoutEffects";

const SCORE_INFO = {
  partCount: 1,
  partNames: ["Piano"],
  measureCount: 1,
  layoutCount: 1,
  scoreCount: 1,
  scoreNames: ["Score"],
} satisfies ScoreInfo;

function displayList(id: string, x: number): DisplayList {
  return {
    commands: [],
    width: 800,
    height: 1000,
    elementBboxes: [{ elementId: id, bbox: { x, y: 100, width: 10, height: 10 } }],
  };
}

function installAnimationFrameQueue(): Array<FrameRequestCallback> {
  const callbacks: Array<FrameRequestCallback> = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return callbacks;
}

function runNextFrame(callbacks: Array<FrameRequestCallback>): void {
  const callback = callbacks.shift();
  expect(callback).toBeDefined();
  callback!(performance.now());
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runFastLayoutAndPaint", () => {
  it("clears stale targets before painting a deferred index rebuild", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const nextDisplayList = displayList("next", 240);
    const spatialIndexRef = { current: {} as SpatialIndex | null };
    const paintNow = vi.fn();

    await runFastLayoutAndPaint({
      json: "{}",
      computeDisplayList: vi.fn().mockResolvedValue(nextDisplayList),
      displayListRef: { current: displayList("previous", 80) },
      displayListVersionRef: { current: 0 },
      spatialIndexRef,
      rafRef: { current: 0 },
      spatialDebounceRef: { current: undefined },
      docScoreRef: { current: null },
      paintNowRef: { current: paintNow },
      perfTracker: new PerfTracker(),
    });

    expect(spatialIndexRef.current).toBeNull();
    expect(paintNow).toHaveBeenCalledWith(true);
  });

  it("replaces stale targets synchronously for an immediate index rebuild", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const nextDisplayList = displayList("next", 240);
    const spatialIndexRef = { current: {} as SpatialIndex | null };
    const paintNow = vi.fn();

    await runFastLayoutAndPaint({
      json: "{}",
      computeDisplayList: vi.fn().mockResolvedValue(nextDisplayList),
      displayListRef: { current: displayList("previous", 80) },
      displayListVersionRef: { current: 0 },
      spatialIndexRef,
      rafRef: { current: 0 },
      spatialDebounceRef: { current: undefined },
      docScoreRef: { current: null },
      paintNowRef: { current: paintNow },
      perfTracker: new PerfTracker(),
      immediateSpatialIndex: true,
    });

    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("next");
    expect(paintNow).toHaveBeenCalledTimes(2);
  });
});

describe("runSecondaryRelayout", () => {
  it("clears stale targets, then rebuilds and repaints without a content-size update", async () => {
    const callbacks = installAnimationFrameQueue();
    const nextDisplayList = displayList("next", 240);
    const displayListRef = { current: displayList("previous", 80) as DisplayList | null };
    const spatialIndexRef = { current: {} as SpatialIndex | null };
    const paintNow = vi.fn();

    await runSecondaryRelayout({
      mnxJson: "{}",
      selectedScoreIndex: 0,
      viewMode: "page",
      computeDisplayList: vi.fn(),
      getScoreInfo: vi.fn(),
      cachedScoreInfoRef: { current: SCORE_INFO },
      displayListRef,
      displayListVersionRef: { current: 0 },
      spatialIndexRef,
      docScoreRef: { current: null },
      paintNowRef: { current: paintNow },
      setDisplayListVersion: vi.fn(),
      precomputedDisplayList: nextDisplayList,
    });

    expect(displayListRef.current).toBe(nextDisplayList);
    expect(spatialIndexRef.current).toBeNull();

    runNextFrame(callbacks);
    expect(paintNow).toHaveBeenCalledTimes(1);
    expect(spatialIndexRef.current).toBeNull();

    runNextFrame(callbacks);
    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("next");
    expect(paintNow).toHaveBeenCalledTimes(2);
  });

  it("does not install an index rebuilt for a superseded display list", async () => {
    const callbacks = installAnimationFrameQueue();
    const olderDisplayList = displayList("older", 80);
    const newerDisplayList = displayList("newer", 240);
    const displayListRef = { current: null as DisplayList | null };
    const spatialIndexRef = { current: null as SpatialIndex | null };
    const paintNow = vi.fn();

    await runSecondaryRelayout({
      mnxJson: "{}",
      selectedScoreIndex: 0,
      viewMode: "page",
      computeDisplayList: vi.fn(),
      getScoreInfo: vi.fn(),
      cachedScoreInfoRef: { current: SCORE_INFO },
      displayListRef,
      displayListVersionRef: { current: 0 },
      spatialIndexRef,
      docScoreRef: { current: null },
      paintNowRef: { current: paintNow },
      setDisplayListVersion: vi.fn(),
      precomputedDisplayList: olderDisplayList,
    });

    runNextFrame(callbacks);
    displayListRef.current = newerDisplayList;
    runNextFrame(callbacks);

    expect(spatialIndexRef.current).toBeNull();
    expect(paintNow).toHaveBeenCalledTimes(1);
  });
});

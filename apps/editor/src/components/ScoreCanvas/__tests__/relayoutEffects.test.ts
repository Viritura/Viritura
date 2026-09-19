import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PatchReconstructor,
  PerfTracker,
  SpatialIndex,
  type DecodedFrame,
  type DisplayList,
  type Placement,
  type ScoreInfo,
} from "@viritura/renderer";
import type { Score } from "@viritura/core";

import { runFastLayoutAndPaint } from "../fastLayout";
import { runSecondaryRelayout, useFastLayoutCallback } from "../relayoutEffects";

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

function scoreWithPart(id: string): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [{ id, measures: [{ sequences: [{ content: [] }] }] }],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
  it("consumes an unpainted patch before the next frame reuses its fresh segment", async () => {
    const reconstructor = new PatchReconstructor();
    const frame = (placement: Placement): DecodedFrame => ({
      kind: "patch",
      patch: {
        width: 800,
        height: 1000,
        galleyOffsetY: 0,
        pages: [],
        prefix: { commands: [], width: 800, height: 1000 },
        overlay: { commands: [], width: 800, height: 1000 },
        placements: [placement],
      },
    });
    const initial = reconstructor.apply(frame({ kind: "fresh", segment: displayList("note", 80) }), true);
    const spatialIndexRef = { current: SpatialIndex.fromDisplayList(initial) };
    const paint = vi.fn();
    const refs = {
      displayListRef: { current: initial },
      spatialIndexRef,
      displayListVersionRef: { current: 0 },
      docScoreRef: { current: null },
      paintNowRef: { current: paint },
      perfTracker: new PerfTracker(),
    };
    await runFastLayoutAndPaint({
      ...refs,
      json: "",
      computeDisplayList: async () =>
        reconstructor.apply(frame({ kind: "fresh", segment: displayList("note", 240) }), true),
      shouldCommit: () => false,
    });
    expect(paint).not.toHaveBeenCalled();
    expect(spatialIndexRef.current.hitTest(85, 105)).toBe("note");
    await runFastLayoutAndPaint({
      ...refs,
      json: "",
      computeDisplayList: async () => reconstructor.apply(frame({ kind: "reuse", prevIndex: 0, dx: 0, dy: 0 }), true),
    });
    expect(spatialIndexRef.current.hitTest(245, 105)).toBe("note");
    expect(spatialIndexRef.current.hitTest(85, 105)).toBeNull();
    expect(paint).toHaveBeenCalledOnce();
  });

  it("commits current hit targets with the newly painted display list", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const nextDisplayList = displayList("next", 240);
    const spatialIndexRef = { current: {} as SpatialIndex | null };
    const paintNow = vi.fn();
    const onDisplayListCommit = vi.fn();

    await runFastLayoutAndPaint({
      json: "{}",
      computeDisplayList: vi.fn().mockResolvedValue(nextDisplayList),
      displayListRef: { current: displayList("previous", 80) },
      displayListVersionRef: { current: 0 },
      spatialIndexRef,
      docScoreRef: { current: null },
      paintNowRef: { current: paintNow },
      perfTracker: new PerfTracker(),
      onDisplayListCommit,
    });

    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("next");
    expect(spatialIndexRef.current?.hitTest(85, 105)).toBeNull();
    expect(paintNow).toHaveBeenCalledTimes(1);
    expect(onDisplayListCommit).toHaveBeenCalledOnce();
  });

  it("replaces stale targets without an intermediate empty index", async () => {
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
      docScoreRef: { current: null },
      paintNowRef: { current: paintNow },
      perfTracker: new PerfTracker(),
    });

    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("next");
    expect(paintNow).toHaveBeenCalledTimes(1);
  });
});

describe("useFastLayoutCallback", () => {
  it("drops a stale deferred paint, drains the latest edit, and keeps current hit targets until final commit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scoreA = scoreWithPart("a");
    const scoreB = scoreWithPart("b");
    const firstLayout = deferred<DisplayList>();
    const finalLayout = deferred<DisplayList>();
    const computeDisplayList = vi
      .fn()
      .mockImplementationOnce((_json, _info, _scoreIdx, _patchInfo, capturedScore) => {
        expect(capturedScore).toBe(scoreA);
        return firstLayout.promise;
      })
      .mockImplementationOnce((_json, _info, _scoreIdx, _patchInfo, capturedScore) => {
        expect(capturedScore).toBe(scoreB);
        return finalLayout.promise;
      });
    const perfTracker = new PerfTracker();
    const paintedDisplayList = displayList("painted", 80);
    const finalDisplayList = displayList("final", 240);
    const displayListRef = { current: paintedDisplayList as DisplayList | null };
    const spatialIndexRef = { current: SpatialIndex.fromDisplayList(paintedDisplayList) as SpatialIndex | null };
    const docScoreRef = { current: scoreA as Score | null };
    const paintNow = vi.fn();
    const lastFastPaintedJsonRef = { current: "" };
    const pendingFastJsonRef = { current: "" };
    const onDisplayListCommit = vi.fn();

    renderHook(() =>
      useFastLayoutCallback({
        wasmReady: true,
        computeDisplayList,
        selectedScoreIndex: 0,
        perfTrackerRef: { current: perfTracker },
        cachedScoreInfoRef: { current: SCORE_INFO },
        displayListRef,
        displayListVersionRef: { current: 0 },
        spatialIndexRef,
        docScoreRef,
        paintNowRef: { current: paintNow },
        onDisplayListCommit,
        lastFastPaintedJsonRef,
        pendingFastJsonRef,
      }),
    );

    const firstPaint = perfTracker.fastLayoutCallback?.("first");
    expect(pendingFastJsonRef.current).toBe("first");
    docScoreRef.current = scoreB;
    firstLayout.resolve(displayList("stale", 160));
    await firstPaint;

    expect(displayListRef.current).toBe(paintedDisplayList);
    expect(spatialIndexRef.current?.hitTest(85, 105)).toBe("painted");
    expect(spatialIndexRef.current?.hitTest(165, 105)).toBeNull();
    expect(lastFastPaintedJsonRef.current).toBe("");
    expect(paintNow).not.toHaveBeenCalled();
    expect(onDisplayListCommit).not.toHaveBeenCalled();

    const finalPaint = perfTracker.fastLayoutCallback?.("final");
    finalLayout.resolve(finalDisplayList);
    await finalPaint;

    expect(displayListRef.current).toBe(finalDisplayList);
    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("final");
    expect(spatialIndexRef.current?.hitTest(85, 105)).toBeNull();
    expect(lastFastPaintedJsonRef.current).toBe("final");
    expect(pendingFastJsonRef.current).toBe("");
    expect(paintNow).toHaveBeenCalledOnce();
    expect(onDisplayListCommit).toHaveBeenCalledOnce();
  });

  it("clears pending fast layout state after an error so queued edits can drain", async () => {
    const computeError = new Error("layout failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const perfTracker = new PerfTracker();
    const lastFastPaintedJsonRef = { current: "" };
    const pendingFastJsonRef = { current: "" };

    renderHook(() =>
      useFastLayoutCallback({
        wasmReady: true,
        computeDisplayList: vi.fn().mockRejectedValue(computeError),
        selectedScoreIndex: 0,
        perfTrackerRef: { current: perfTracker },
        cachedScoreInfoRef: { current: SCORE_INFO },
        displayListRef: { current: null },
        displayListVersionRef: { current: 0 },
        spatialIndexRef: { current: null },
        docScoreRef: { current: scoreWithPart("error") },
        paintNowRef: { current: vi.fn() },
        onDisplayListCommit: vi.fn(),
        lastFastPaintedJsonRef,
        pendingFastJsonRef,
      }),
    );

    await perfTracker.fastLayoutCallback?.("broken");
    await flushMicrotasks();

    expect(pendingFastJsonRef.current).toBe("");
    expect(lastFastPaintedJsonRef.current).toBe("");
    expect(consoleError).toHaveBeenCalledWith("[FastLayout] WASM layout error:", computeError);
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
    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("next");

    runNextFrame(callbacks);
    expect(paintNow).toHaveBeenCalledTimes(1);
    expect(spatialIndexRef.current?.hitTest(245, 105)).toBe("next");
    expect(paintNow).toHaveBeenCalledTimes(1);
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

    const newerSpatialIndex = SpatialIndex.fromDisplayList(newerDisplayList);
    displayListRef.current = newerDisplayList;
    spatialIndexRef.current = newerSpatialIndex;
    runNextFrame(callbacks);

    expect(spatialIndexRef.current).toBe(newerSpatialIndex);
    expect(paintNow).not.toHaveBeenCalled();
  });
});

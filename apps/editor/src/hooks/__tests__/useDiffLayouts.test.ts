import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffLayouts } from "../useDiffLayouts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const { layoutCalls, fullScoreLayoutCalls, scoreInfo, dispose } = vi.hoisted(() => ({
  layoutCalls: [] as Array<{ json: string; result: Deferred<unknown> }>,
  fullScoreLayoutCalls: [] as Array<{ json: string; result: Deferred<unknown> }>,
  scoreInfo: { partCount: 2 },
  dispose: vi.fn(),
}));

vi.mock("@viritura/renderer", () => ({
  createLayoutService: () => ({
    ready: Promise.resolve(true),
    isReady: () => true,
    getScoreInfo: async () => scoreInfo,
    engine: {
      computeFullScoreLayout: (json: string) => {
        const result = deferred<unknown>();
        fullScoreLayoutCalls.push({ json, result });
        return result.promise;
      },
      computeLayout: (json: string) => {
        const result = deferred<unknown>();
        layoutCalls.push({ json, result });
        return result.promise;
      },
    },
    dispose,
  }),
  loadMusicFont: () => Promise.resolve(),
  getScoreInfo: vi.fn(),
  wasmComputeFullScoreLayout: vi.fn(),
  wasmComputeLayout: vi.fn(),
  paintCommandsCulled: vi.fn(),
  GlyphAtlas: class {},
}));

describe("useDiffLayouts", () => {
  beforeEach(() => {
    layoutCalls.length = 0;
    fullScoreLayoutCalls.length = 0;
    scoreInfo.partCount = 2;
    dispose.mockClear();
  });

  it("drops intermediate history selections while a layout is in flight", async () => {
    const { rerender, unmount } = renderHook(
      ({ originalText, modifiedText }) =>
        useDiffLayouts({ originalText, modifiedText, useWritten: undefined, oversized: false }),
      { initialProps: { originalText: '{"revision":"a-before"}', modifiedText: '{"revision":"a-after"}' } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fullScoreLayoutCalls.map((call) => call.json)).toEqual(['{"revision":"a-before"}']);

    rerender({ originalText: '{"revision":"b-before"}', modifiedText: '{"revision":"b-after"}' });
    rerender({ originalText: '{"revision":"c-before"}', modifiedText: '{"revision":"c-after"}' });

    await act(async () => {
      fullScoreLayoutCalls[0]!.result.resolve({ width: 1, height: 1, commands: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fullScoreLayoutCalls.map((call) => call.json)).toEqual([
      '{"revision":"a-before"}',
      '{"revision":"c-before"}',
    ]);

    await act(async () => {
      fullScoreLayoutCalls[1]!.result.resolve({ width: 1, height: 1, commands: [] });
      await Promise.resolve();
    });
    expect(fullScoreLayoutCalls.map((call) => call.json)).toEqual([
      '{"revision":"a-before"}',
      '{"revision":"c-before"}',
      '{"revision":"c-after"}',
    ]);

    await act(async () => {
      fullScoreLayoutCalls[2]!.result.resolve({ width: 1, height: 1, commands: [] });
      await Promise.resolve();
    });
    const disposalsBeforeUnmount = dispose.mock.calls.length;
    unmount();
    expect(dispose).toHaveBeenCalledTimes(disposalsBeforeUnmount + 1);
  });

  it("routes a zero-part score through full-score layout", async () => {
    scoreInfo.partCount = 0;

    renderHook(() =>
      useDiffLayouts({
        originalText: '{"revision":"zero-part"}',
        modifiedText: '{"revision":"zero-part-mod"}',
        useWritten: undefined,
        oversized: false,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fullScoreLayoutCalls.map((call) => call.json)).toEqual(['{"revision":"zero-part"}']);
    expect(layoutCalls).toEqual([]);
  });

  it("routes a single-part score through single-layout", async () => {
    scoreInfo.partCount = 1;

    renderHook(() =>
      useDiffLayouts({
        originalText: '{"revision":"single-part"}',
        modifiedText: '{"revision":"single-part-mod"}',
        useWritten: undefined,
        oversized: false,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(layoutCalls.map((call) => call.json)).toEqual(['{"revision":"single-part"}']);
    expect(fullScoreLayoutCalls).toEqual([]);
  });
});

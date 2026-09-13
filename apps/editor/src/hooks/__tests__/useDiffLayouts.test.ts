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

const { layoutCalls, getScoreInfo, dispose } = vi.hoisted(() => ({
  layoutCalls: [] as Array<{ json: string; partIndex?: number; result: Deferred<unknown> }>,
  getScoreInfo: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@viritura/renderer", () => ({
  createLayoutService: () => ({
    ready: Promise.resolve(true),
    isReady: () => true,
    getScoreInfo,
    engine: {
      computeFullScoreLayout: (json: string) => {
        const result = deferred<unknown>();
        layoutCalls.push({ json, result });
        return result.promise;
      },
      computeLayout: (json: string, partIndex: number) => {
        const result = deferred<unknown>();
        layoutCalls.push({ json, partIndex, result });
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
    getScoreInfo.mockReset().mockResolvedValue({ partCount: 2 });
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
    expect(layoutCalls.map((call) => call.json)).toEqual(['{"revision":"a-before"}']);

    rerender({ originalText: '{"revision":"b-before"}', modifiedText: '{"revision":"b-after"}' });
    rerender({ originalText: '{"revision":"c-before"}', modifiedText: '{"revision":"c-after"}' });

    await act(async () => {
      layoutCalls[0]!.result.resolve({ width: 1, height: 1, commands: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(layoutCalls.map((call) => call.json)).toEqual(['{"revision":"a-before"}', '{"revision":"c-before"}']);

    await act(async () => {
      layoutCalls[1]!.result.resolve({ width: 1, height: 1, commands: [] });
      await Promise.resolve();
    });
    expect(layoutCalls.map((call) => call.json)).toEqual([
      '{"revision":"a-before"}',
      '{"revision":"c-before"}',
      '{"revision":"c-after"}',
    ]);

    await act(async () => {
      layoutCalls[2]!.result.resolve({ width: 1, height: 1, commands: [] });
      await Promise.resolve();
    });
    const disposalsBeforeUnmount = dispose.mock.calls.length;
    unmount();
    expect(dispose).toHaveBeenCalledTimes(disposalsBeforeUnmount + 1);
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [1, 0],
    [0, 1],
  ])("completes both Review layouts (%i original parts, %i modified parts)", async (originalParts, modifiedParts) => {
    getScoreInfo
      .mockResolvedValueOnce({ partCount: originalParts })
      .mockResolvedValueOnce({ partCount: modifiedParts });
    const originalText = '{"revision":"before"}';
    const modifiedText = '{"revision":"after"}';
    const originalDl = { width: 100, height: 200, commands: [] };
    const modifiedDl = { width: 300, height: 400, commands: [] };
    const { result, unmount } = renderHook(() =>
      useDiffLayouts({ originalText, modifiedText, useWritten: undefined, oversized: false }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(layoutCalls.map(({ json, partIndex }) => ({ json, partIndex }))).toEqual([
      { json: originalText, partIndex: originalParts === 1 ? 0 : undefined },
    ]);

    await act(async () => {
      layoutCalls[0]!.result.resolve(originalDl);
      await Promise.resolve();
    });
    expect(layoutCalls.map(({ json, partIndex }) => ({ json, partIndex }))).toEqual([
      { json: originalText, partIndex: originalParts === 1 ? 0 : undefined },
      { json: modifiedText, partIndex: modifiedParts === 1 ? 0 : undefined },
    ]);

    await act(async () => {
      layoutCalls[1]!.result.resolve(modifiedDl);
      await Promise.resolve();
    });
    expect(getScoreInfo.mock.calls).toEqual([[originalText], [modifiedText]]);
    expect(result.current.ready).toBe(true);
    expect(result.current.originalDl).toBe(originalDl);
    expect(result.current.modifiedDl).toBe(modifiedDl);
    unmount();
  });
});

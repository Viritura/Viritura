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

const { layoutCalls, dispose } = vi.hoisted(() => ({
  layoutCalls: [] as Array<{ json: string; result: Deferred<unknown> }>,
  dispose: vi.fn(),
}));

vi.mock("@viritura/renderer", () => ({
  createLayoutService: () => ({
    ready: Promise.resolve(true),
    isReady: () => true,
    getScoreInfo: async () => ({ partCount: 2 }),
    engine: {
      computeFullScoreLayout: (json: string) => {
        const result = deferred<unknown>();
        layoutCalls.push({ json, result });
        return result.promise;
      },
      computeLayout: vi.fn(),
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
});

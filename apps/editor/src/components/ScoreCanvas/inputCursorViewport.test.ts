import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { mapEnginePointToViewport } from "../inputCursorHelpers";
import { computeInputCursorRecovery, resolveInputCursorViewportTarget } from "./inputCursorViewport";
import { useInputCursorViewportFollow } from "./useInputCursorViewportFollow";

const displayList: DisplayList = {
  commands: [],
  width: 800,
  height: 2000,
  pages: [
    { pageNumber: 1, yOffset: 0, width: 800, height: 1000 },
    { pageNumber: 2, yOffset: 1000, width: 800, height: 1000 },
  ],
  measureBounds: [
    {
      index: 1,
      partIndex: 0,
      staffIndex: 0,
      x: 100,
      y: 1100,
      width: 400,
      height: 100,
      prefixWidth: 0,
      totalBeats: 4,
      beatAnchors: [
        [0, 100],
        [4, 500],
      ],
    },
  ],
};

const score: Score = {
  mnx: { version: 1 },
  global: { measures: [{ time: { count: 4, unit: 4 } }, { time: { count: 4, unit: 4 } }] },
  parts: [{ measures: [{ sequences: [{ content: [] }] }, { sequences: [{ content: [] }] }] }],
};

describe("input cursor viewport recovery", () => {
  it("does not move an already visible cursor", () => {
    expect(
      computeInputCursorRecovery({ x: 500, y: 300 }, { scrollX: 0, scrollY: 0, zoom: 1 }, 1000, 700, {
        left: 280,
        top: 12,
        right: 12,
        bottom: 12,
      }),
    ).toBeNull();
  });

  it("returns the overflowed cursor to 15% of the panel-safe width", () => {
    expect(
      computeInputCursorRecovery({ x: 1100, y: 300 }, { scrollX: 0, scrollY: 0, zoom: 1 }, 1000, 700, {
        left: 280,
        top: 12,
        right: 12,
        bottom: 12,
      }),
    ).toEqual({ x: 713.8, y: 0 });
  });

  it("centers a vertically overflowed cursor in the usable viewport", () => {
    expect(
      computeInputCursorRecovery({ x: 500, y: 1000 }, { scrollX: 0, scrollY: 0, zoom: 1 }, 1000, 700, {
        left: 280,
        top: 12,
        right: 12,
        bottom: 12,
      }),
    ).toEqual({ x: 0, y: 650 });
  });

  it("maps paged cursor geometry through the page-stack gap", () => {
    expect(
      resolveInputCursorViewportTarget(
        { measureIndex: 1, beatPosition: 2, partIndex: 0, staffIndex: 0 },
        score,
        displayList,
        1,
        "page",
      ),
    ).toEqual({ x: 300, y: 1230 });
  });

  it("maps horizontal-spread cursor geometry through its page placement", () => {
    expect(
      resolveInputCursorViewportTarget(
        { measureIndex: 1, beatPosition: 2, partIndex: 0, staffIndex: 0 },
        score,
        displayList,
        1,
        "spread-h",
      ),
    ).toEqual({ x: 2020, y: 150 });
  });

  it("maps the persistent cursor through the same paged transform as recovery", () => {
    expect(mapEnginePointToViewport({ x: 300, y: 1150 }, displayList, "page")).toEqual({ x: 300, y: 1230 });
  });

  it("skips activation and follows only a later cursor advance", () => {
    const setScroll = vi.fn();
    const containerRef = { current: { clientWidth: 300, clientHeight: 300 } as HTMLDivElement };
    const { rerender } = renderHook(
      ({ beatPosition }: { beatPosition: number }) =>
        useInputCursorViewportFollow({
          active: true,
          cursor: { measureIndex: 1, beatPosition, partIndex: 0, staffIndex: 0 },
          score,
          displayList,
          displayListVersion: 1,
          voice: 1,
          viewMode: "page",
          viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
          containerRef,
          safeArea: undefined,
          setScroll,
        }),
      { initialProps: { beatPosition: 0 } },
    );

    expect(setScroll).not.toHaveBeenCalled();
    rerender({ beatPosition: 4 });
    expect(setScroll).toHaveBeenCalledWith(455, 1080);
  });
});

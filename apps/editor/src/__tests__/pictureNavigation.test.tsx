import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { usePictureTiming } from "../components/modes/picture/usePictureTiming";

vi.mock("@viritura/playback", () => ({
  usePlaybackState: () => ({ playheadPosition: null }),
}));

vi.mock("@viritura/video-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@viritura/video-sync")>()),
  useVideoSyncState: () => ({
    frameRateId: "24",
    hitPoints: [],
    pictureOffsetSeconds: 0,
    mediaDurationSeconds: null,
  }),
}));

describe("Picture navigation timing", () => {
  it("reports an incomplete navigation route without crashing the activity", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, { jump: { type: "dsAlFine", location: { fraction: [1, 1] } } }],
      },
      parts: [],
    };
    const { result, rerender } = renderHook(({ input }) => usePictureTiming(input), {
      initialProps: { input: score },
    });
    expect(result.current.error).toContain("exactly one segno");
    expect(result.current.bars).toEqual([]);

    rerender({
      input: {
        ...score,
        global: {
          measures: [
            {
              time: { count: 4, unit: 4 },
              segno: { location: { fraction: [1, 4] } },
              fine: { location: { fraction: [3, 4] } },
            },
            score.global.measures[1]!,
          ],
        },
      },
    });
    expect(result.current.error).toBeNull();
    expect(result.current.bars.map((bar) => bar.number)).toEqual([1, 2, 1]);
    expect(result.current.durationSeconds).toBeCloseTo(5);
  });
});

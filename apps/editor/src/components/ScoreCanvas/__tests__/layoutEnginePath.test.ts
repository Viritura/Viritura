import { describe, expect, it, vi } from "vitest";
import { EMPTY_LAYOUT_METRICS, PerfTracker, type DisplayList } from "@viritura/renderer";
import type { LayoutBackend } from "../layoutBackend";
import { runLayoutEnginePath } from "../layoutEnginePath";

const displayList: DisplayList = { commands: [], width: 0, height: 0 };

function backend(): LayoutBackend {
  return {
    isReady: () => true,
    isWorker: false,
    hasRetainedScore: () => false,
    cacheStats: () => [0, 0],
    layoutMetrics: () => EMPTY_LAYOUT_METRICS,
    getScoreInfo: vi.fn(),
    computeMnxScoreLayout: vi.fn(),
    computeLayout: vi.fn().mockResolvedValue(displayList),
    computeFullScoreLayout: vi.fn().mockResolvedValue(displayList),
    relayoutRetainedScore: vi.fn(),
    applyPatchAndLayout: vi.fn(),
    fullLayout: vi.fn(),
    invalidateCache: vi.fn(),
    setEmitLayoutDebug: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("runLayoutEnginePath", () => {
  it.each([
    { partCount: 0, scoreCount: 1 },
    { partCount: 0, scoreCount: 0 },
    { partCount: 2, scoreCount: 1 },
  ])("uses full-score layout for $partCount parts and $scoreCount scores", async ({ partCount, scoreCount }) => {
    const engine = backend();
    const result = await runLayoutEnginePath({
      engine,
      mnxJson: "{}",
      info: { partCount, scoreCount, measureCount: 32, layoutCount: 1, partNames: [], scoreNames: [] },
      scoreIdx: 0,
      partIndex: 0,
      sp: 10,
      pageWidthPx: 800,
      pageSetupJson: "{}",
      perfTracker: new PerfTracker(),
      setLayoutPerfDebug: vi.fn(),
    });

    expect(result).toBe(displayList);
    expect(engine.computeFullScoreLayout).toHaveBeenCalledWith("{}", 10, 800, "{}");
    expect(engine.computeLayout).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    "preserves the selected single-part/multi-score route with $scoreCount scores",
    async (scoreCount) => {
      const engine = backend();
      await runLayoutEnginePath({
        engine,
        mnxJson: "{}",
        info: { partCount: 1, scoreCount, measureCount: 32, layoutCount: 1, partNames: [], scoreNames: [] },
        scoreIdx: 1,
        partIndex: 0,
        sp: 10,
        pageWidthPx: 800,
        pageSetupJson: "{}",
        perfTracker: new PerfTracker(),
        setLayoutPerfDebug: vi.fn(),
      });

      if (scoreCount === 1) {
        expect(engine.computeLayout).toHaveBeenCalledWith("{}", 0, 10, 800, "{}");
        expect(engine.computeFullScoreLayout).not.toHaveBeenCalled();
      } else {
        expect(engine.computeFullScoreLayout).toHaveBeenCalledWith("{}", 10, 800, "{}", 1);
        expect(engine.computeLayout).not.toHaveBeenCalled();
      }
    },
  );
});

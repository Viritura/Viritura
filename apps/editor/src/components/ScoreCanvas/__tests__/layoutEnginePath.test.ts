import { describe, expect, it, vi } from "vitest";
import { EMPTY_LAYOUT_METRICS, PerfTracker, type DisplayList, type ScoreInfo } from "@viritura/renderer";
import { runLayoutEnginePath } from "../layoutEnginePath";
import type { LayoutBackend } from "../layoutBackend";

const DISPLAY_LIST: DisplayList = {
  commands: [],
  width: 0,
  height: 0,
};

function createBackend(): LayoutBackend {
  return {
    isWorker: true,
    isReady: () => true,
    hasRetainedScore: () => false,
    cacheStats: () => [0, 0],
    layoutMetrics: () => ({ ...EMPTY_LAYOUT_METRICS }),
    getScoreInfo: vi.fn(),
    computeMnxScoreLayout: vi.fn().mockResolvedValue(DISPLAY_LIST),
    computeLayout: vi.fn().mockResolvedValue(DISPLAY_LIST),
    computeFullScoreLayout: vi.fn().mockResolvedValue(DISPLAY_LIST),
    relayoutRetainedScore: vi.fn().mockResolvedValue(null),
    applyPatchAndLayout: vi.fn().mockResolvedValue(DISPLAY_LIST),
    fullLayout: vi.fn().mockResolvedValue(DISPLAY_LIST),
    invalidateCache: vi.fn(),
    setEmitLayoutDebug: vi.fn(),
    dispose: vi.fn(),
  };
}

function scoreInfo(partCount: number): ScoreInfo {
  return {
    partCount,
    partNames: [],
    measureCount: 32,
    layoutCount: 1,
    scoreCount: 1,
    scoreNames: ["Full score"],
  };
}

async function runLayout(engine: LayoutBackend, info: ScoreInfo): Promise<void> {
  await runLayoutEnginePath({
    engine,
    mnxJson: "{}",
    info,
    scoreIdx: 0,
    partIndex: 0,
    sp: 12,
    pageWidthPx: 800,
    pageSetupJson: "{}",
    perfTracker: new PerfTracker(),
    setLayoutPerfDebug: vi.fn(),
  });
}

describe("runLayoutEnginePath", () => {
  it("uses full-score layout for a new score with no parts", async () => {
    const engine = createBackend();

    await runLayout(engine, scoreInfo(0));

    expect(engine.computeFullScoreLayout).toHaveBeenCalledWith("{}", 12, 800, "{}", 0);
    expect(engine.computeLayout).not.toHaveBeenCalled();
  });

  it("preserves the only authored score's written view and source layout", async () => {
    const engine = createBackend();

    await runLayout(engine, scoreInfo(1));

    expect(engine.computeFullScoreLayout).toHaveBeenCalledWith("{}", 12, 800, "{}", 0);
    expect(engine.computeLayout).not.toHaveBeenCalled();
  });

  it("uses single-part layout when no score definition exists", async () => {
    const engine = createBackend();

    await runLayout(engine, { ...scoreInfo(1), scoreCount: 0, scoreNames: [] });

    expect(engine.computeLayout).toHaveBeenCalledWith("{}", 0, 12, 800, "{}");
    expect(engine.computeFullScoreLayout).not.toHaveBeenCalled();
  });
});

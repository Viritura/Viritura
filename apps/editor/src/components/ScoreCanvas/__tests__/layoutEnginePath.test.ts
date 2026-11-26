import { describe, expect, it, vi } from "vitest";
import { EMPTY_LAYOUT_METRICS, PerfTracker, type DisplayList, type ScoreInfo } from "@viritura/renderer";
import { runLayoutEnginePath } from "../layoutEnginePath";
import { computeDisplayListImpl, tryRelayoutScoreView } from "../computeDisplayList";
import type { LayoutBackend } from "../layoutBackend";
import { DEFAULT_PART_PAGE_SETUP } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { getRenderedStaffSources } from "../renderedStaffSources";
import multipleLayouts from "../../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx?raw";

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

  describe("source part layout", () => {
    it.each([
      [undefined, true],
      [false, false],
    ])(
      "lays out the selected source part with override %s (written: %s)",
      async (useWrittenOverride, expectedWritten) => {
        const engine = createBackend();
        const score = parseMnx(JSON.parse(multipleLayouts));
        const projectedList: DisplayList = {
          ...DISPLAY_LIST,
          measureBounds: [
            {
              index: 0,
              staffIndex: 0,
              partIndex: 0,
              x: 0,
              y: 0,
              width: 100,
              height: 40,
              prefixWidth: 0,
              totalBeats: 4,
              beatAnchors: [],
            },
          ],
        };
        vi.mocked(engine.computeMnxScoreLayout).mockResolvedValue(projectedList);
        const result = await computeDisplayListImpl({
          engine,
          mnxJson: multipleLayouts,
          info: scoreInfo(score.parts.length),
          scoreIdx: 0,
          partIndex: 0,
          sourcePartIndex: 1,
          useWrittenOverride,
          viewMode: "horizon",
          selectedPartIds: [score.parts[1]!.id!],
          expandedCondensingStaves: undefined,
          score,
          perfTracker: new PerfTracker(),
          setLayoutPerfDebug: vi.fn(),
          pageSetupRef: { current: DEFAULT_PART_PAGE_SETUP },
          showHiddenRests: false,
        });
        const call = vi.mocked(engine.computeMnxScoreLayout).mock.calls[0];
        expect(call).toBeDefined();
        const projected = parseMnx(JSON.parse(call![0]));
        expect(projected.parts.map((part) => part.id)).toEqual([score.parts[1]!.id]);
        expect(projected.scores?.[0]?.useWritten).toBe(expectedWritten);
        expect(call![3]).toBe(0);
        expect(getRenderedStaffSources(result)).toEqual([
          { staffIndex: 0, measureIndex: 0, partIds: [score.parts[1]!.id] },
        ]);
      },
    );
  });

  it.each([true, false])(
    "projects pitch %s for only the selected score without changing the retained document",
    async (useWritten) => {
      const engine = createBackend();
      vi.spyOn(engine, "hasRetainedScore").mockReturnValue(true);
      const score = parseMnx(JSON.parse(multipleLayouts));
      score.scores![0]!.useWritten = true;
      score.scores![1]!.useWritten = !useWritten;
      const original = structuredClone(score);
      const args = {
        engine,
        mnxJson: JSON.stringify(serializeMnx(score)),
        info: scoreInfo(score.parts.length),
        scoreIdx: 1,
        partIndex: 0,
        useWrittenOverride: useWritten,
        viewMode: "page" as const,
        selectedPartIds: undefined,
        expandedCondensingStaves: undefined,
        score,
        perfTracker: new PerfTracker(),
        setLayoutPerfDebug: vi.fn(),
        pageSetupRef: { current: DEFAULT_PART_PAGE_SETUP },
        showHiddenRests: false,
      };
      expect(await tryRelayoutScoreView(args)).toBeNull();
      await computeDisplayListImpl(args);
      const call = vi.mocked(engine.computeMnxScoreLayout).mock.calls[0]!;
      const projected = parseMnx(JSON.parse(call[0]));
      expect(projected.scores?.[1]?.useWritten).toBe(useWritten);
      expect(projected.scores?.[0]?.useWritten).toBe(true);
      expect(projected.parts).toEqual(original.parts);
      expect(score).toEqual(original);
      expect(call[3]).toBe(1);
      expect(engine.relayoutRetainedScore).not.toHaveBeenCalled();
      expect(engine.computeFullScoreLayout).not.toHaveBeenCalled();
    },
  );

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

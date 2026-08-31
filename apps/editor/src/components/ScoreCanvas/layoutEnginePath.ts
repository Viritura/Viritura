import { type DisplayList, type PatchInfo, type PerfTracker, type ScoreInfo } from "@viritura/renderer";
import type { LayoutBackend } from "./layoutBackend";
import { buildPatchJson } from "./layoutHelpers";

export interface ComputeLayoutArgs {
  engine: LayoutBackend;
  mnxJson: string;
  info: ScoreInfo;
  scoreIdx: number;
  partIndex: number;
  sp: number;
  pageWidthPx: number;
  pageSetupJson: string;
  patchInfo?: PatchInfo;
  perfTracker: PerfTracker;
  setLayoutPerfDebug: (info: Record<string, unknown>) => void;
}

/**
 * Pick the best layout engine path (patch → cached full → stateless),
 * run it, and update perf-tracker cache stats / debug telemetry.
 */
export async function runLayoutEnginePath(args: ComputeLayoutArgs): Promise<DisplayList> {
  const {
    engine,
    mnxJson,
    info,
    scoreIdx,
    partIndex,
    sp,
    pageWidthPx,
    pageSetupJson,
    patchInfo,
    perfTracker,
    setLayoutPerfDebug,
  } = args;

  const changedPartMeasureCount = patchInfo
    ? Array.from(patchInfo.changedPartMeasures.values()).reduce((sum, indices) => sum + indices.length, 0)
    : 0;
  const changedGlobalMeasureCount = patchInfo?.changedGlobalMeasures.length ?? 0;
  const patchMeasureCount = changedPartMeasureCount + changedGlobalMeasureCount;

  // Patch path: use cached engine's incremental API when available
  if (patchInfo && !patchInfo.structuralChange && engine.hasRetainedScore()) {
    const result = await tryPatchPath({
      engine,
      mnxJson,
      patchInfo,
      sp,
      pageWidthPx,
      pageSetupJson,
      scoreIdx,
      patchMeasureCount,
      perfTracker,
      setLayoutPerfDebug,
    });
    if (result) return result;
    // Fall through to full layout on patch error
  }

  const fullMnxJson = patchInfo?.fallbackJson?.() ?? mnxJson;

  // Full layout via the backend (retains Score for future patches; the
  // backend falls back to stateless WASM internally when no engine exists).
  return runCachedFullLayout({
    engine,
    mnxJson: fullMnxJson,
    info,
    scoreIdx,
    partIndex,
    sp,
    pageWidthPx,
    pageSetupJson,
    patchInfo,
    patchMeasureCount,
    perfTracker,
    setLayoutPerfDebug,
  });
}

async function tryPatchPath(args: {
  engine: LayoutBackend;
  mnxJson: string;
  patchInfo: PatchInfo;
  sp: number;
  pageWidthPx: number;
  pageSetupJson: string;
  scoreIdx: number;
  patchMeasureCount: number;
  perfTracker: PerfTracker;
  setLayoutPerfDebug: (info: Record<string, unknown>) => void;
}): Promise<DisplayList | null> {
  const {
    engine,
    mnxJson,
    patchInfo,
    sp,
    pageWidthPx,
    pageSetupJson,
    scoreIdx,
    patchMeasureCount,
    perfTracker,
    setLayoutPerfDebug,
  } = args;
  try {
    performance.mark("viritura:patch-build-start");
    const patchJson = patchInfo.prebuiltPatchJson ?? buildPatchJson(mnxJson, patchInfo);
    performance.mark("viritura:patch-build-end");
    performance.measure("viritura:patch-build", "viritura:patch-build-start", "viritura:patch-build-end");

    performance.mark("viritura:patch-layout-start");
    const result = await engine.applyPatchAndLayout(patchJson, sp, pageWidthPx, pageSetupJson, scoreIdx);
    performance.mark("viritura:patch-layout-end");
    performance.measure("viritura:patch-layout", "viritura:patch-layout-start", "viritura:patch-layout-end");

    const [hits, misses] = engine.cacheStats();
    perfTracker.cacheHits = hits;
    perfTracker.cacheMisses = misses;
    setLayoutPerfDebug({ path: "patch", patchMeasureCount, cacheHits: hits, cacheMisses: misses });
    return result;
  } catch (err) {
    setLayoutPerfDebug({
      path: "patch-fallback",
      patchMeasureCount,
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function runCachedFullLayout(args: {
  engine: LayoutBackend;
  mnxJson: string;
  info: ScoreInfo;
  scoreIdx: number;
  partIndex: number;
  sp: number;
  pageWidthPx: number;
  pageSetupJson: string;
  patchInfo?: PatchInfo;
  patchMeasureCount: number;
  perfTracker: PerfTracker;
  setLayoutPerfDebug: (info: Record<string, unknown>) => void;
}): Promise<DisplayList> {
  const {
    engine,
    mnxJson,
    info,
    scoreIdx,
    partIndex,
    sp,
    pageWidthPx,
    pageSetupJson,
    patchInfo,
    patchMeasureCount,
    perfTracker,
    setLayoutPerfDebug,
  } = args;
  const result =
    info.scoreCount > 1
      ? await engine.computeFullScoreLayout(mnxJson, sp, pageWidthPx, pageSetupJson, scoreIdx)
      : info.partCount > 1
        ? await engine.computeFullScoreLayout(mnxJson, sp, pageWidthPx, pageSetupJson)
        : await engine.computeLayout(mnxJson, partIndex, sp, pageWidthPx, pageSetupJson);
  const [hits, misses] = engine.cacheStats();
  perfTracker.cacheHits = hits;
  perfTracker.cacheMisses = misses;
  setLayoutPerfDebug({
    path: patchInfo?.structuralChange ? "full-structural" : patchInfo ? "full-no-retained-score" : "full-no-patch",
    patchMeasureCount,
    cacheHits: hits,
    cacheMisses: misses,
  });
  return result;
}

import { useEffect } from "react";
import type { DisplayList, PatchInfo, PerfTracker, ScoreInfo, SpatialIndex } from "@viritura/renderer";
import { buildEnrichedSpatialIndex } from "../../store/enrichSpatialIndex";
import type { PageSetup, Score } from "@viritura/core";
import { runBackgroundTask } from "../../store/backgroundTaskStore";
import { tryRelayoutScoreView } from "./computeDisplayList";
import { runFastLayoutAndPaint } from "./fastLayout";
import { contentSizeForMode } from "./initialLoad";
import type { LayoutBackend } from "./layoutBackend";
import type { WriteViewMode as ViewMode } from "@viritura/ui";

interface FastLayoutCallbackArgs {
  wasmReady: boolean;
  computeDisplayList: (
    mnxJson: string,
    info: ScoreInfo,
    scoreIdx: number,
    patchInfo?: PatchInfo,
  ) => Promise<DisplayList>;
  selectedScoreIndex: number;
  perfTrackerRef: { current: PerfTracker };
  cachedScoreInfoRef: { current: ScoreInfo | null };
  displayListRef: { current: DisplayList | null };
  displayListVersionRef: { current: number };
  spatialIndexRef: { current: SpatialIndex | null };
  rafRef: { current: number };
  spatialDebounceRef: { current: ReturnType<typeof setTimeout> | undefined };
  docScoreRef: { current: Score | null };
  paintNowRef: { current: (forceDirect?: boolean) => void };
  lastFastPaintedJsonRef: { current: string };
  /** JSON currently being laid out off-thread. Set synchronously so the
   *  mnxJson useEffect doesn't double-apply the same edit while the worker
   *  layout is still in flight. */
  pendingFastJsonRef: { current: string };
  /** Current interaction mode. In "engrave", spatial-index rebuilds run
   *  immediately (not debounced) so a just-dragged element is re-grabbable
   *  on the very next pointer-down. */
  interactionModeRef: { current: "write" | "engrave" };
  /** Whether a selection is currently active. When true, spatial-index
   *  rebuilds run immediately so the selection overlay tracks the new
   *  geometry instead of lagging one edit behind (e.g. on transpose). */
  selectionActiveRef: { current: boolean };
}

/**
 * Wire the synchronous fast-layout callback onto the global perf tracker.
 * `DocumentContext.updateScore` calls this BEFORE React state updates so the
 * canvas repaints as soon as the (off-thread) layout resolves, eliminating the
 * ~32 ms react-schedule gap that the useEffect fallback path incurs.
 */
export function useFastLayoutCallback(args: FastLayoutCallbackArgs): void {
  const {
    wasmReady,
    computeDisplayList,
    selectedScoreIndex,
    perfTrackerRef,
    cachedScoreInfoRef,
    displayListRef,
    displayListVersionRef,
    spatialIndexRef,
    rafRef,
    spatialDebounceRef,
    docScoreRef,
    paintNowRef,
    lastFastPaintedJsonRef,
    pendingFastJsonRef,
    interactionModeRef,
    selectionActiveRef,
  } = args;

  useEffect(() => {
    const perf = perfTrackerRef.current;
    // Worker calls are uncancellable. Sequence every callback invocation so a
    // reset/new request supersedes the old result even when the serialized JSON
    // is identical (or only selectedScoreIndex changed).
    let latestRequestId = 0;
    perf.fastLayoutCallback = (json: string, patchInfo?: PatchInfo) => {
      if (!wasmReady || !cachedScoreInfoRef.current) return;
      const requestId = ++latestRequestId;
      // Mark this JSON as in-flight synchronously so the mnxJson useEffect
      // (which runs ~32 ms later, before the worker resolves) skips it instead
      // of laying out — and patching — the same edit a second time.
      pendingFastJsonRef.current = json;
      performance.mark("viritura:fast-effect-start");
      try {
        performance.measure("viritura:react-schedule", "viritura:setState-done", "viritura:fast-effect-start");
      } catch {
        /* ignore */
      }
      // Return the layout promise so the caller (the document store's layout
      // coalescer) can fire the next queued edit only once this one has
      // resolved — collapsing a fast-typed burst onto the single worker.
      return (async () => {
        try {
          await runFastLayoutAndPaint({
            json,
            computeDisplayList: (j, pi) => computeDisplayList(j, cachedScoreInfoRef.current!, selectedScoreIndex, pi),
            patchInfo,
            shouldCommit: () => requestId === latestRequestId && pendingFastJsonRef.current === json,
            displayListRef,
            displayListVersionRef,
            spatialIndexRef,
            rafRef,
            spatialDebounceRef,
            docScoreRef,
            paintNowRef,
            perfTracker: perf,
            immediateSpatialIndex: interactionModeRef.current === "engrave" || selectionActiveRef.current,
          });
          lastFastPaintedJsonRef.current = json;
        } catch (err) {
          console.error("[FastLayout] WASM layout error:", err);
          // will fall back to useEffect path
        } finally {
          // Only clear if no newer edit superseded us.
          if (pendingFastJsonRef.current === json) pendingFastJsonRef.current = "";
        }
      })();
    };
    return () => {
      latestRequestId += 1;
      perf.fastLayoutCallback = null;
    };
  }, [wasmReady, computeDisplayList, selectedScoreIndex]);
}

interface SecondaryRelayoutArgs {
  mnxJson: string;
  selectedScoreIndex: number;
  viewMode: ViewMode;
  computeDisplayList: (mnxJson: string, info: ScoreInfo, scoreIdx: number) => Promise<DisplayList>;
  getScoreInfo: (mnxJson: string) => Promise<ScoreInfo>;
  cachedScoreInfoRef: { current: ScoreInfo | null };
  displayListRef: { current: DisplayList | null };
  displayListVersionRef: { current: number };
  spatialIndexRef: { current: SpatialIndex | null };
  docScoreRef: { current: Score | null };
  paintNowRef: { current: (forceDirect?: boolean) => void };
  setContentSize?: (size: { width: number; height: number }) => void;
  setDisplayListVersion: (updater: (v: number) => number) => void;
  /** True for the debug-toggle path (forces engine cache invalidation, no contentSize update). */
  forceDirectPaint?: boolean;
  /** Pre-computed display list (fast layout-switch path). When provided, skips
   *  the full `computeDisplayList` call (which re-parses the MNX JSON). */
  precomputedDisplayList?: DisplayList | null;
  /** Returns true if a newer relayout has superseded this one. Checked after the
   *  async layout resolves; when stale, the result is discarded instead of
   *  committed so it can't clobber the current view. */
  isStale?: () => boolean;
}

/**
 * Shared helper for the three secondary relayout effects (score-definition
 * change, container-width change, spacing-debug toggle). Computes a fresh
 * display list, rebuilds the spatial index, optionally updates contentSize,
 * bumps the version, and force-repaints.
 */
export async function runSecondaryRelayout(args: SecondaryRelayoutArgs): Promise<void> {
  const {
    mnxJson,
    selectedScoreIndex,
    viewMode,
    computeDisplayList,
    getScoreInfo,
    cachedScoreInfoRef,
    displayListRef,
    displayListVersionRef,
    spatialIndexRef,
    docScoreRef,
    paintNowRef,
    setContentSize,
    setDisplayListVersion,
    forceDirectPaint,
    precomputedDisplayList,
  } = args;
  const info = cachedScoreInfoRef.current ?? (await getScoreInfo(mnxJson));
  const displayList = precomputedDisplayList ?? (await computeDisplayList(mnxJson, info, selectedScoreIndex));
  // A newer view switch may have started while the worker was busy. Committing
  // this now would paint a stale layout (commonly snapping back to the full
  // score), so drop it and let the latest relayout own the display list.
  if (args.isStale?.()) {
    return;
  }
  displayListRef.current = displayList;
  if (setContentSize) {
    setContentSize(contentSizeForMode(displayList, viewMode));
  }
  displayListVersionRef.current += 1;
  setDisplayListVersion((v) => v + 1);
  requestAnimationFrame(() => {
    // Paint first for instant visual feedback, then rebuild the spatial index
    // on a *subsequent* frame. The index is only needed for mouse interaction
    // (click/hover), not rendering, so building it synchronously before the
    // paint would block the view switch for large scores (it walks the whole
    // display list). Deferring keeps the switch responsive.
    paintNowRef.current(forceDirectPaint ?? false);
    if (setContentSize) {
      const scoreSnapshot = docScoreRef.current;
      requestAnimationFrame(() => {
        spatialIndexRef.current = buildEnrichedSpatialIndex(displayList, scoreSnapshot);
      });
    }
  });
}

interface ScoreViewRelayoutArgs {
  selectedScoreIndex: number;
  scoreDefinitions: string[];
  wasmReady: boolean;
  mnxJson: string;
  viewMode: ViewMode;
  selectedPartIds: string[] | undefined;
  expandedCondensingStaves: Set<string> | undefined;
  computeDisplayList: SecondaryRelayoutArgs["computeDisplayList"];
  backendRef: { current: LayoutBackend | null };
  docScoreRef: { current: Score | null };
  pageSetupRef: { current: PageSetup };
  cachedScoreInfoRef: { current: ScoreInfo | null };
  displayListRef: { current: DisplayList | null };
  displayListVersionRef: { current: number };
  spatialIndexRef: { current: SpatialIndex | null };
  paintNowRef: { current: (forceDirect?: boolean) => void };
  lastRelayoutKeyRef: { current: string };
  lastRelayoutJsonRef: { current: string };
  viewSwitchTokenRef: { current: number };
  setContentSize: (size: { width: number; height: number }) => void;
  setDisplayListVersion: (updater: (version: number) => number) => void;
}

export function useScoreViewRelayout(args: ScoreViewRelayoutArgs): void {
  const {
    selectedScoreIndex,
    scoreDefinitions,
    wasmReady,
    mnxJson,
    viewMode,
    selectedPartIds,
    expandedCondensingStaves,
    computeDisplayList,
    backendRef,
    docScoreRef,
    pageSetupRef,
    cachedScoreInfoRef,
    displayListRef,
    displayListVersionRef,
    spatialIndexRef,
    paintNowRef,
    lastRelayoutKeyRef,
    lastRelayoutJsonRef,
    viewSwitchTokenRef,
    setContentSize,
    setDisplayListVersion,
  } = args;

  useEffect(() => {
    if (!wasmReady || !mnxJson) return;
    const backend = backendRef.current;
    if (!backend || !backend.hasRetainedScore()) return;
    const layoutClass = viewMode === "horizon" ? "horizon" : "paged";
    const partFilterKey = (selectedPartIds ?? []).join(",");
    const expandedKey = expandedCondensingStaves ? [...expandedCondensingStaves].sort().join(",") : "";
    const relayoutKey = `${selectedScoreIndex}|${layoutClass}|${scoreDefinitions.join("\u001f")}|${partFilterKey}|${expandedKey}`;
    if (lastRelayoutKeyRef.current === relayoutKey) {
      const displayList = displayListRef.current;
      if (displayList) setContentSize(contentSizeForMode(displayList, viewMode));
      return;
    }

    const relayoutToken = ++viewSwitchTokenRef.current;
    void runBackgroundTask("Switching view…", () =>
      tryRelayoutScoreView({
        scoreIdx: selectedScoreIndex,
        viewMode,
        selectedPartIds,
        expandedCondensingStaves,
        score: docScoreRef.current,
        engine: backend,
        pageSetupRef,
      }).then((precomputedDisplayList) =>
        runSecondaryRelayout({
          mnxJson,
          selectedScoreIndex,
          viewMode,
          computeDisplayList,
          getScoreInfo: (json) => backend.getScoreInfo(json),
          cachedScoreInfoRef,
          displayListRef,
          displayListVersionRef,
          spatialIndexRef,
          docScoreRef,
          paintNowRef,
          setContentSize,
          setDisplayListVersion,
          forceDirectPaint: true,
          precomputedDisplayList,
          isStale: () => viewSwitchTokenRef.current !== relayoutToken,
        }),
      ),
    );
    lastRelayoutKeyRef.current = relayoutKey;
    lastRelayoutJsonRef.current = mnxJson;
  }, [
    selectedScoreIndex,
    scoreDefinitions,
    wasmReady,
    mnxJson,
    computeDisplayList,
    viewMode,
    selectedPartIds,
    expandedCondensingStaves,
  ]);
}

import {
  computeHorizonPaperGeometry,
  computeDisplayListContentBounds,
  type DisplayList,
  type PerfTracker,
  type ScoreInfo,
  type SpatialIndex,
} from "@viritura/renderer";
import { buildEnrichedSpatialIndex } from "../../store/enrichSpatialIndex";
import type { PageSetup, Score } from "@viritura/core";
import { computePageViewContentSize, computeSpreadContentSize, computeSpreadHContentSize } from "./viewportGeometry";
import type { WriteViewMode as ViewMode } from "@viritura/ui";

/** Return the content-size needed by the viewport for the current view mode. */
export function contentSizeForMode(displayList: DisplayList, viewMode: ViewMode): { width: number; height: number } {
  if (viewMode === "spread") return computeSpreadContentSize(displayList);
  if (viewMode === "spread-h") return computeSpreadHContentSize(displayList);
  if (viewMode === "page") return computePageViewContentSize(displayList);
  // Horizon uses the painted horizontal extent so edge text remains reachable.
  // Vertically, center the viewport on the same ink midpoint used to size the
  // synthetic paper card; nominal display-list height often contains uneven
  // empty space and would visibly bias short Storybook examples upward.
  const bounds = computeDisplayListContentBounds(displayList);
  return { width: bounds.maxX, height: computeHorizonPaperGeometry(displayList).contentHeight };
}

export function scoreViewRelayoutKey(
  scoreIndex: number,
  viewMode: ViewMode,
  scoreDefinitions: readonly string[],
  selectedPartIds?: readonly string[],
  expandedCondensingStaves?: ReadonlySet<string>,
  pageSetupOverride?: PageSetup,
  sourcePartIndex?: number,
): string {
  const layoutClass = viewMode === "horizon" ? "horizon" : "paged";
  const parts = (selectedPartIds ?? []).join(",");
  const expanded = expandedCondensingStaves ? [...expandedCondensingStaves].sort().join(",") : "";
  const pageSetup = pageSetupOverride ? JSON.stringify(pageSetupOverride) : "";
  return `${scoreIndex}|${layoutClass}|${scoreDefinitions.join("\u001f")}|${parts}|${expanded}|${pageSetup}|${sourcePartIndex ?? ""}`;
}

interface InitialLoadArgs {
  mnxJson: string;
  getScoreInfo: (json: string) => Promise<ScoreInfo>;
  computeDisplayList: (json: string, info: ScoreInfo, scoreIdx: number) => Promise<DisplayList>;
  viewMode: ViewMode;
  containerWidth: number;
  debugEnabled: boolean;
  selectedScoreIndex: number;
  selectedPartIds?: readonly string[];
  expandedCondensingStaves?: ReadonlySet<string>;
  pageSetupOverride?: PageSetup;
  sourcePartIndex?: number;
  cachedScoreInfoRef: { current: ScoreInfo | null };
  displayListRef: { current: DisplayList | null };
  spatialIndexRef: { current: SpatialIndex | null };
  docScoreRef: { current: Score | null };
  perfTracker: PerfTracker;
  lastScoreDefinitionRelayoutKeyRef: { current: string };
  lastViewRelayoutJsonRef: { current: string };
  lastContainerWidthRelayoutRef: { current: number | null };
  lastDebugRelayoutKeyRef: { current: string };
  setScoreInfo: (s: string) => void;
  setScoreDefinitions: (defs: string[]) => void;
  setContentSize: (s: { width: number; height: number }) => void;
  clearSelection: () => void;
  onLayoutCommitted?: (key: string) => void;
  isStale?: () => boolean;
}

/** Full initial-load layout pass: fetches ScoreInfo, runs full WASM layout,
 * builds the spatial index, and seeds the viewport's content size. */

export async function runInitialLoad(args: InitialLoadArgs): Promise<void> {
  const {
    mnxJson,
    getScoreInfo,
    computeDisplayList,
    viewMode,
    containerWidth,
    debugEnabled,
    selectedScoreIndex,
    selectedPartIds,
    expandedCondensingStaves,
    pageSetupOverride,
    sourcePartIndex,
    cachedScoreInfoRef,
    displayListRef,
    spatialIndexRef,
    docScoreRef,
    perfTracker,
    lastScoreDefinitionRelayoutKeyRef,
    lastViewRelayoutJsonRef,
    lastContainerWidthRelayoutRef,
    lastDebugRelayoutKeyRef,
    setScoreInfo,
    setScoreDefinitions,
    setContentSize,
    clearSelection,
  } = args;
  const info = await getScoreInfo(mnxJson);
  if (args.isStale?.()) return;
  cachedScoreInfoRef.current = info;
  perfTracker.scoreComplexity = `${info.measureCount}m × ${info.partCount}p`;
  setScoreInfo(
    `${info.measureCount} measure${info.measureCount !== 1 ? "s" : ""} · ${info.partNames.filter(Boolean).join(", ") || "1 part"} · Rust/WASM engine`,
  );

  // Seed the same key used by view relayout to avoid a second full layout.
  const scoreNames = info.scoreCount > 1 ? info.scoreNames : [];
  setScoreDefinitions(scoreNames);
  const layoutKey = scoreViewRelayoutKey(
    selectedScoreIndex,
    viewMode,
    scoreNames,
    selectedPartIds,
    expandedCondensingStaves,
    pageSetupOverride,
    sourcePartIndex,
  );
  lastScoreDefinitionRelayoutKeyRef.current = layoutKey;
  lastViewRelayoutJsonRef.current = mnxJson;

  const t0 = performance.now();
  // Lay out the *selected* score index — NOT a hardcoded 0. The key seeded just
  // above uses `selectedScoreIndex`, so the committed display list must match it;
  // otherwise the view-switch effect sees a "current" key but the wrong (full-
  // score) layout on screen.
  const displayList = await computeDisplayList(mnxJson, info, selectedScoreIndex);
  if (args.isStale?.()) return;
  const t1 = performance.now();
  displayListRef.current = displayList;
  spatialIndexRef.current = buildEnrichedSpatialIndex(displayList, docScoreRef.current);
  const t2 = performance.now();

  perfTracker.wasmLayoutMs = t1 - t0;
  perfTracker.spatialIndexMs = t2 - t1;

  clearSelection();
  setContentSize(contentSizeForMode(displayList, viewMode));
  args.onLayoutCommitted?.(layoutKey);
  lastContainerWidthRelayoutRef.current = containerWidth;
  lastDebugRelayoutKeyRef.current = `${debugEnabled}|${selectedScoreIndex}|${info.scoreCount}`;
}

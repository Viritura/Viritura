import type { DisplayList, PatchInfo, PerfTracker, ScoreInfo } from "@viritura/renderer";
import type { PageSetup, Score } from "@viritura/core";
import { defaultPageSetupForScore, pageTurnConfigForLayout } from "@viritura/core";
import type { LayoutBackend } from "./layoutBackend";
import { injectExpandedStaves, injectSyntheticLayout } from "./layoutHelpers";
import { runLayoutEnginePath } from "./layoutEnginePath";
import { PX_PER_MM } from "./constants";
import type { WriteViewMode as ViewMode } from "@viritura/ui";

interface ComputeDisplayListArgs {
  mnxJson: string;
  info: ScoreInfo;
  scoreIdx: number;
  patchInfo?: PatchInfo;
  partIndex: number;
  viewMode: ViewMode;
  selectedPartIds: string[] | undefined;
  expandedCondensingStaves: Set<string> | undefined;
  score: Score | null;
  engine: LayoutBackend | null;
  perfTracker: PerfTracker;
  setLayoutPerfDebug: (info: Record<string, unknown>) => void;
  pageSetupRef: { current: PageSetup };
}

/**
 * Build the engine-facing `page_turns` sub-object for the page-setup JSON.
 * Returns `{}` when disabled (or in horizon mode, where the engine never
 * paginates) so the engine keeps its default greedy pagination. Expands the
 * editor settings into the concrete `PageTurnConfig` knobs the engine reads.
 */
function buildPageTurnsPayload(ps: PageSetup, viewMode: ViewMode): Record<string, unknown> {
  const pt = ps.pageTurns;
  if (!pt?.enabled || viewMode === "horizon") return {};
  return {
    page_turns: pageTurnConfigForLayout(pt),
  };
}

/**
 * Resolve active page setup for a score view and derive the WASM layout
 * parameters (spatium px, page width px, page-setup JSON). Mutates
 * `pageSetupRef.current` so paint code sees the geometry that was laid out.
 */
function resolvePageSetup(
  score: Score | null,
  scoreIdx: number,
  viewMode: ViewMode,
  pageSetupRef: { current: PageSetup },
): { sp: number; pageWidthPx: number; pageSetupJson: string } {
  const activeScoreDef = score?.scores?.[scoreIdx];
  const defaults = defaultPageSetupForScore(score?.scores, scoreIdx, score?.layouts, score?.parts?.length);
  const ps: PageSetup = {
    ...defaults,
    ...activeScoreDef?.pageSetup,
    margins: {
      ...defaults.margins,
      ...activeScoreDef?.pageSetup?.margins,
    },
  };
  pageSetupRef.current = ps;

  const sp = ps.spatiumMm * PX_PER_MM;
  const pageWidthPx = viewMode === "horizon" ? 0 : Math.round(ps.width * PX_PER_MM);
  const pageSetupJson = JSON.stringify({
    page_height: ps.height / ps.spatiumMm,
    page_margin_top: ps.margins.top / ps.spatiumMm,
    page_margin_bottom: ps.margins.bottom / ps.spatiumMm,
    page_margin_left: ps.margins.left / ps.spatiumMm,
    page_margin_right: ps.margins.right / ps.spatiumMm,
    ...buildPageTurnsPayload(ps, viewMode),
  });
  return { sp, pageWidthPx, pageSetupJson };
}

/**
 * Fast layout-switch path: re-lay-out the engine's already-retained Score for
 * a different score view WITHOUT re-parsing the (potentially huge) MNX JSON.
 *
 * Only valid when no MNX-mutating injection is active (staff filter or
 * condensing expansion both rewrite the JSON before parse, so the retained
 * score wouldn't match). Returns null when the fast path doesn't apply, so the
 * caller falls back to a full `computeDisplayListImpl`.
 */
export function tryRelayoutScoreView(args: {
  scoreIdx: number;
  viewMode: ViewMode;
  selectedPartIds: string[] | undefined;
  expandedCondensingStaves: Set<string> | undefined;
  score: Score | null;
  engine: LayoutBackend | null;
  pageSetupRef: { current: PageSetup };
}): Promise<DisplayList | null> {
  const { scoreIdx, viewMode, selectedPartIds, expandedCondensingStaves, score, engine, pageSetupRef } = args;
  if (!engine || !engine.hasRetainedScore()) return Promise.resolve(null);
  if (selectedPartIds && selectedPartIds.length >= 1) return Promise.resolve(null);
  if (expandedCondensingStaves && expandedCondensingStaves.size > 0) return Promise.resolve(null);
  const { sp, pageWidthPx, pageSetupJson } = resolvePageSetup(score, scoreIdx, viewMode, pageSetupRef);
  return engine.relayoutRetainedScore(sp, pageWidthPx, pageSetupJson, scoreIdx);
}

/**
 * Pre-warm the per-edit patch chain by firing one throwaway empty-patch
 * `applyPatchAndLayout` right after the initial full layout.
 *
 * The app seeds the engine via the *cached* full-layout path, which populates
 * the retained per-system segments but NOT the recorded `last_system_order`
 * (that field is only written on the patch-frame path). Because of that, the
 * user's FIRST edit hits an empty prior order and pays a one-time all-Fresh
 * re-seed — ~1 s on a 510-measure × 33-part score — before steady edits drop
 * to ~140 ms. Running that re-seed here, off the critical path and before the
 * first keystroke, makes the first *user* edit as fast as every subsequent one.
 *
 * The empty patch `{}` mutates nothing; the call exists purely for its side
 * effects — the engine records the system order and the patch reconstructor
 * captures the segments. The resulting DisplayList is identical to what is
 * already painted, so it is discarded.
 *
 * No-op when the engine isn't retaining a score, or when an MNX-rewriting
 * injection is active (staff filter / condensing expansion don't use the patch
 * chain, so there is nothing to pre-warm).
 */
export async function prewarmPatchChain(args: {
  scoreIdx: number;
  viewMode: ViewMode;
  selectedPartIds: string[] | undefined;
  expandedCondensingStaves: Set<string> | undefined;
  score: Score | null;
  engine: LayoutBackend | null;
  pageSetupRef: { current: PageSetup };
}): Promise<void> {
  const { scoreIdx, viewMode, selectedPartIds, expandedCondensingStaves, score, engine, pageSetupRef } = args;
  if (!engine || !engine.hasRetainedScore()) return;
  if (selectedPartIds && selectedPartIds.length >= 1) return;
  if (expandedCondensingStaves && expandedCondensingStaves.size > 0) return;
  const { sp, pageWidthPx, pageSetupJson } = resolvePageSetup(score, scoreIdx, viewMode, pageSetupRef);
  await engine.applyPatchAndLayout("{}", sp, pageWidthPx, pageSetupJson, scoreIdx);
}

/**
 * Resolve active page setup, build the WASM page-setup JSON, apply
 * staff-filter / condensing-expansion injections, and dispatch to
 * `runLayoutEnginePath`. Mutates `pageSetupRef.current` so paint code sees
 * the actual page geometry that was laid out.
 */
export function computeDisplayListImpl(args: ComputeDisplayListArgs): Promise<DisplayList> {
  const {
    mnxJson,
    info,
    scoreIdx,
    patchInfo,
    partIndex,
    viewMode,
    selectedPartIds,
    expandedCondensingStaves,
    score,
    engine,
    perfTracker,
    setLayoutPerfDebug,
    pageSetupRef,
  } = args;

  const { sp, pageWidthPx, pageSetupJson } = resolvePageSetup(score, scoreIdx, viewMode, pageSetupRef);

  if (!engine) {
    return Promise.reject(new Error("Layout backend not ready"));
  }

  // Incremental edits intentionally pass an empty `mnxJson`; their patch
  // contains the changed measures and the fallback callback provides the
  // complete immutable document. Projection rewrites (selection filtering and
  // condensed expansion) need that complete document before they can inject
  // synthetic layout content.
  const sourceJson = patchInfo?.fallbackJson?.() ?? mnxJson;

  // Staff filter: inject synthetic layout when staves are ctrl/shift-selected
  if (selectedPartIds && selectedPartIds.length >= 1) {
    const { json, scoreIndex } = injectSyntheticLayout(sourceJson, selectedPartIds, scoreIdx);
    return engine.computeMnxScoreLayout(json, sp, pageWidthPx, scoreIndex, pageSetupJson);
  }

  // Condensing expansion: like the staff filter above, this rewrites the MNX
  // before parse, so it must go through the *stateless* score-layout entry
  // point. `runLayoutEnginePath` would call `computeFullScoreLayout`, which
  // retains the laid-out Score — and the retained copy would then be the
  // *expanded* one. Collapsing sets the expansion set back to empty, which
  // re-enables the `relayoutRetainedScore` fast path, and that would faithfully
  // re-render the retained (still expanded) score: expand worked, collapse
  // silently did nothing. Keeping the retained score equal to the unmodified
  // document is what makes collapse correct.
  if (expandedCondensingStaves && expandedCondensingStaves.size > 0) {
    const expandedJson = injectExpandedStaves(sourceJson, scoreIdx, expandedCondensingStaves);
    return engine.computeMnxScoreLayout(expandedJson, sp, pageWidthPx, scoreIdx, pageSetupJson);
  }

  return runLayoutEnginePath({
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
  });
}

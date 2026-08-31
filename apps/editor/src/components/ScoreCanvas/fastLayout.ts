import { type DisplayList, type PatchInfo, type PerfTracker, type SpatialIndex } from "@viritura/renderer";
import { updateEnrichedSpatialIndexForPatch } from "../../store/enrichSpatialIndex";
import type { Score } from "@viritura/core";

export interface FastLayoutRefs {
  /** Mutable ref bag — shared with ScoreCanvas. */
  displayListRef: { current: DisplayList | null };
  displayListVersionRef: { current: number };
  spatialIndexRef: { current: SpatialIndex | null };
  rafRef: { current: number };
  spatialDebounceRef: { current: ReturnType<typeof setTimeout> | undefined };
  docScoreRef: { current: Score | null };
  paintNowRef: { current: (forceDirect?: boolean) => void };
  perfTracker: PerfTracker;
}

/**
 * Run WASM layout, swap in the new display list, repaint, and schedule a
 * debounced spatial-index rebuild. Shared by the fastLayoutCallback path
 * (synchronous, called from `updateScore` before React renders) and the
 * useEffect fast-path fallback. Throws on WASM errors — caller decides
 * whether to fall back or surface the error.
 */
export async function runFastLayoutAndPaint(
  args: {
    json: string;
    computeDisplayList: (json: string, patchInfo?: PatchInfo) => Promise<DisplayList>;
    patchInfo?: PatchInfo;
    /**
     * Re-check after the async worker layout resolves, before mutating any
     * display-list/spatial-index refs. Used to suppress an uncancellable result
     * from a document generation superseded by `LayoutCoalescer.reset()`.
     */
    shouldCommit?: () => boolean;
    /** When true, rebuild the spatial index synchronously instead of on the
     *  150 ms debounce. Used in engrave mode so a just-dragged element is
     *  immediately re-grabbable (the debounced index would still report its
     *  pre-edit hit region, so the next pointer-down would miss and deselect). */
    immediateSpatialIndex?: boolean;
  } & FastLayoutRefs,
): Promise<void> {
  const {
    json,
    computeDisplayList,
    patchInfo,
    shouldCommit,
    immediateSpatialIndex = false,
    displayListRef,
    displayListVersionRef,
    spatialIndexRef,
    rafRef,
    spatialDebounceRef,
    docScoreRef,
    paintNowRef,
    perfTracker,
  } = args;

  performance.mark("viritura:wasm-layout-start");
  const t0 = performance.now();
  const displayList = await computeDisplayList(json, patchInfo);
  const t1 = performance.now();
  performance.mark("viritura:wasm-layout-end");
  performance.measure("viritura:wasm-layout", "viritura:wasm-layout-start", "viritura:wasm-layout-end");

  // Worker RPCs cannot be cancelled. A document load/reset can dispatch the
  // new document while the old one's call is still queued/running; suppress
  // that stale result rather than briefly repainting the old score or
  // rebuilding its spatial index against the new model.
  if (shouldCommit && !shouldCommit()) return;

  const previousDisplayList = displayListRef.current;
  displayListRef.current = displayList;
  perfTracker.wasmLayoutMs = t1 - t0;

  displayListVersionRef.current += 1;
  performance.mark("viritura:raf-callback");
  performance.mark("viritura:repaint-call");
  // Direct render for instant feedback — spatial index deferred
  paintNowRef.current(true);
  if (displayList.finalizeRetainedFrame) {
    performance.mark("viritura:compatibility-reconstruct-start");
    displayList.finalizeRetainedFrame();
    performance.mark("viritura:compatibility-reconstruct-end");
    try {
      performance.measure(
        "viritura:compatibility-reconstruct",
        "viritura:compatibility-reconstruct-start",
        "viritura:compatibility-reconstruct-end",
      );
    } catch {
      /* optional performance telemetry */
    }
  }

  scheduleSpatialIndexRebuild({
    displayList,
    previousDisplayList,
    patchInfo,
    rafRef,
    spatialDebounceRef,
    docScoreRef,
    spatialIndexRef,
    perfTracker,
    paintNowRef,
    immediate: immediateSpatialIndex,
  });
}

/**
 * Debounce spatial index rebuild: only run 150ms after the last edit.
 * Spatial index is only needed for mouse interaction (click-to-select,
 * hover), not for visual rendering, so skipping it during rapid typing
 * avoids wasting ~18ms per keystroke on a 23-part score.
 */
function scheduleSpatialIndexRebuild(args: {
  displayList: DisplayList;
  previousDisplayList: DisplayList | null;
  patchInfo?: PatchInfo;
  rafRef: { current: number };
  spatialDebounceRef: { current: ReturnType<typeof setTimeout> | undefined };
  docScoreRef: { current: Score | null };
  spatialIndexRef: { current: SpatialIndex | null };
  perfTracker: PerfTracker;
  paintNowRef: { current: (forceDirect?: boolean) => void };
  /** Rebuild synchronously now instead of on the 150 ms debounce. */
  immediate?: boolean;
}): void {
  const {
    displayList,
    previousDisplayList,
    patchInfo,
    rafRef,
    spatialDebounceRef,
    docScoreRef,
    spatialIndexRef,
    perfTracker,
    paintNowRef,
    immediate,
  } = args;
  cancelAnimationFrame(rafRef.current);
  clearTimeout(spatialDebounceRef.current);
  const scoreSnapshot = docScoreRef.current;
  const rebuild = (): void => {
    performance.mark("viritura:spatial-start");
    const s0 = performance.now();
    spatialIndexRef.current = updateEnrichedSpatialIndexForPatch(
      spatialIndexRef.current,
      previousDisplayList,
      displayList,
      scoreSnapshot,
      patchInfo,
    );
    perfTracker.spatialIndexMs = performance.now() - s0;
    performance.mark("viritura:spatial-end");
    try {
      performance.measure("viritura:spatial-index", "viritura:spatial-start", "viritura:spatial-end");
    } catch {
      /* ignore */
    }
    // Repaint so overlays that read from the spatial index (e.g. the selection
    // highlight) re-render at the freshly-laid-out geometry. Without this the
    // overlay keeps painting the pre-rebuild bbox and lags one edit behind
    // (e.g. transposing a selected note leaves the blue highlight a step away).
    paintNowRef.current(true);
  };
  if (immediate) {
    rebuild();
    return;
  }
  spatialDebounceRef.current = setTimeout(() => {
    rafRef.current = requestAnimationFrame(rebuild);
  }, 150);
}

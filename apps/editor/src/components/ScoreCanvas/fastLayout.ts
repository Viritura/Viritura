import { type DisplayList, type PatchInfo, type PerfTracker, type SpatialIndex } from "@viritura/renderer";
import { buildEnrichedSpatialIndex } from "../../store/enrichSpatialIndex";
import type { Score } from "@viritura/core";

export interface FastLayoutRefs {
  /** Mutable ref bag — shared with ScoreCanvas. */
  displayListRef: { current: DisplayList | null };
  displayListVersionRef: { current: number };
  spatialIndexRef: { current: SpatialIndex | null };
  docScoreRef: { current: Score | null };
  paintNowRef: { current: (forceDirect?: boolean) => void };
  perfTracker: PerfTracker;
  onDisplayListCommit?: () => void;
}

/**
 * Run WASM layout, swap in the new display list, repaint, and schedule a
 * matching spatial index. Shared by the fastLayoutCallback path
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
  } & FastLayoutRefs,
): Promise<void> {
  const {
    json,
    computeDisplayList,
    patchInfo,
    shouldCommit,
    displayListRef,
    displayListVersionRef,
    spatialIndexRef,
    docScoreRef,
    paintNowRef,
    perfTracker,
    onDisplayListCommit,
  } = args;

  performance.mark("viritura:wasm-layout-start");
  const t0 = performance.now();
  const displayList = await computeDisplayList(json, patchInfo);
  const t1 = performance.now();
  performance.mark("viritura:wasm-layout-end");
  performance.measure("viritura:wasm-layout", "viritura:wasm-layout-start", "viritura:wasm-layout-end");

  // Consume even an unpainted frame: the next patch may reuse a segment that
  // was freshly supplied here. Skipping this leaves the flattened stores a
  // generation behind the reconstructor's segment order.
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

  // Worker RPCs cannot be cancelled; only the current model may publish hit
  // targets and paint. Transport retention above must still advance in order.
  if (shouldCommit && !shouldCommit()) return;

  performance.mark("viritura:spatial-start");
  const s0 = performance.now();
  // A measure edit can move other systems/staves. Retained display lists also
  // mutate in place, so their "previous" measure bounds are not a before-image.
  // Index the authoritative frame rather than retaining stale hit regions.
  const spatialIndex = buildEnrichedSpatialIndex(displayList, docScoreRef.current);
  perfTracker.spatialIndexMs = performance.now() - s0;
  performance.mark("viritura:spatial-end");
  try {
    performance.measure("viritura:spatial-index", "viritura:spatial-start", "viritura:spatial-end");
  } catch {
    /* ignore */
  }

  displayListRef.current = displayList;
  spatialIndexRef.current = spatialIndex;
  perfTracker.wasmLayoutMs = t1 - t0;
  displayListVersionRef.current += 1;
  onDisplayListCommit?.();
  performance.mark("viritura:raf-callback");
  performance.mark("viritura:repaint-call");
  paintNowRef.current(true);
}

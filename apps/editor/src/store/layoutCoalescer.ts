/**
 * Drop-stale / latest-wins layout coalescer.
 *
 * The editor lays out off the main thread on a *single* layout worker, which
 * processes `applyPatchAndLayout` calls strictly FIFO. When the user types
 * faster than one layout completes (~87 ms/edit on a 510m × 33p score), a naive
 * "dispatch every edit" policy builds a queue where each intermediate result is
 * already stale by the time it paints — the worker grinds through N serial
 * computes and the user briefly sees the score as it was 1, 2, 3 edits ago.
 *
 * This coalescer keeps at most **one in-flight** layout and **one pending**
 * request. While a layout is in flight, new edits don't enqueue — they fold
 * into the pending request (latest JSON wins; the changed-measure sets are
 * unioned). When the in-flight layout resolves, the pending request fires,
 * already reflecting every edit typed since. A 6-keystroke burst settles in
 * ~2 computes instead of 6, and the final paint is the latest model.
 *
 * It adds **zero latency** relative to firing immediately: the next layout
 * fires the instant the worker goes idle (no debounce timer). The trade vs. a
 * FIFO queue is that intermediate states are *skipped*, not shown — which is
 * correct, since they're stale the moment they'd paint.
 *
 * ## Byte-correctness — why unioning measure sets is safe
 *
 * The patch the engine applies carries the *current* content of the changed
 * measures, extracted by `DeltaSerializer.buildPatch(measureSet)` from the
 * serializer's per-measure content cache. That cache is updated on every
 * `serialize()` (which the store runs on every edit, even coalesced ones), and
 * is **independent** of the change-detection bookkeeping. So `buildPatch(union)`
 * at fire time extracts the *latest* content for every measure in the union —
 * including measures whose change was detected by a dropped intermediate edit.
 * Dropping an edit's *layout* never drops its *content*; the union guarantees
 * the eventual patch covers it.
 */

import type { PatchInfo } from "@viritura/renderer";

/** One edit's serialized output + which measures it touched. */
export interface CoalescerInput {
  json: string;
  fallbackJson?: () => string;
  changedGlobalMeasures: number[];
  changedPartMeasures: Map<number, number[]>;
  structuralChange: boolean;
  timeSignatureSettingsChange?: boolean;
}

export class LayoutCoalescer {
  private inFlight = false;
  /**
   * Increments on reset. An older dispatch may still resolve (worker RPCs are
   * not cancellable), but its `finally` must not mark a newer generation idle
   * or drain that generation's pending request concurrently.
   */
  private generation = 0;
  private pendingJson: string | null = null;
  private pendingFallbackJson: (() => string) | undefined;
  private readonly pendingGlobal = new Set<number>();
  private readonly pendingPart = new Map<number, Set<number>>();
  private pendingStructural = false;
  private pendingTimeSignatureSettings = false;
  private pendingWaiters: Array<() => void> = [];

  /**
   * @param buildPatch Build the WASM patch JSON for a union of changed measures
   *   from the serializer's *current* content cache. Called at fire time.
   * @param dispatch Run one layout+paint; resolves when the off-thread layout
   *   has resolved (so the next pending request can fire onto the freed worker).
   */
  constructor(
    private readonly buildPatch: (
      global: number[],
      part: Map<number, number[]>,
      includeTimeSignatureSettings: boolean,
    ) => string,
    private readonly dispatch: (json: string, patchInfo: PatchInfo | undefined) => void | Promise<void>,
  ) {}

  /** Submit one edit. Fires immediately when idle, else folds into pending. */
  submit(input: CoalescerInput): Promise<void> {
    return new Promise((resolve) => {
      if (this.inFlight) {
        this.accumulate(input, resolve);
        return;
      }
      this.fire(
        input.json,
        input.fallbackJson,
        input.changedGlobalMeasures,
        input.changedPartMeasures,
        input.structuralChange,
        input.timeSignatureSettingsChange ?? false,
        [resolve],
      );
    });
  }

  /** Drop all in-flight/pending state. Call on document load / cache reset. */
  reset(): void {
    this.generation += 1;
    this.inFlight = false;
    this.pendingJson = null;
    this.pendingFallbackJson = undefined;
    this.pendingGlobal.clear();
    this.pendingPart.clear();
    this.pendingStructural = false;
    this.pendingTimeSignatureSettings = false;
    for (const resolve of this.pendingWaiters) resolve();
    this.pendingWaiters = [];
  }

  private accumulate(input: CoalescerInput, resolve: () => void): void {
    this.pendingJson = input.json;
    this.pendingFallbackJson = input.fallbackJson;
    if (input.structuralChange) this.pendingStructural = true;
    if (input.timeSignatureSettingsChange) this.pendingTimeSignatureSettings = true;
    for (const mi of input.changedGlobalMeasures) this.pendingGlobal.add(mi);
    for (const [pi, indices] of input.changedPartMeasures) {
      let set = this.pendingPart.get(pi);
      if (!set) {
        set = new Set();
        this.pendingPart.set(pi, set);
      }
      for (const mi of indices) set.add(mi);
    }
    this.pendingWaiters.push(resolve);
  }

  private fire(
    json: string,
    fallbackJson: (() => string) | undefined,
    global: number[],
    part: Map<number, number[]>,
    structural: boolean,
    timeSignatureSettings: boolean,
    waiters: Array<() => void>,
  ): void {
    const hasPatch = global.length > 0 || part.size > 0 || timeSignatureSettings;
    // Structural changes and updates with no supported patch payload take the
    // full-layout path by passing `undefined` patchInfo.
    const patchInfo: PatchInfo | undefined =
      !structural && hasPatch
        ? {
            changedGlobalMeasures: global,
            changedPartMeasures: part,
            structuralChange: false,
            timeSignatureSettingsChange: timeSignatureSettings,
            prebuiltPatchJson: this.buildPatch(global, part, timeSignatureSettings),
            fallbackJson,
          }
        : undefined;

    const generation = this.generation;
    this.inFlight = true;
    Promise.resolve(this.dispatch(json, patchInfo))
      .catch(() => {
        // Layout errors are handled inside the layout path (it falls back to a
        // full relayout); keep draining so a queued edit still lands.
      })
      .finally(() => {
        for (const resolve of waiters) resolve();
        // `reset()` can start a new document's layout while this uncancellable
        // worker call is still finishing. Never let that stale completion
        // mutate the new generation's one-in-flight/one-pending state.
        if (generation !== this.generation) return;
        this.inFlight = false;
        this.drain();
      });
  }

  private drain(): void {
    if (this.pendingJson === null) return;
    const json = this.pendingJson;
    const fallbackJson = this.pendingFallbackJson;
    const global = [...this.pendingGlobal];
    const part = new Map<number, number[]>([...this.pendingPart].map(([pi, set]) => [pi, [...set]]));
    const structural = this.pendingStructural;
    const timeSignatureSettings = this.pendingTimeSignatureSettings;
    const waiters = this.pendingWaiters;
    this.pendingJson = null;
    this.pendingFallbackJson = undefined;
    this.pendingGlobal.clear();
    this.pendingPart.clear();
    this.pendingStructural = false;
    this.pendingTimeSignatureSettings = false;
    this.pendingWaiters = [];
    this.fire(json, fallbackJson, global, part, structural, timeSignatureSettings, waiters);
  }
}

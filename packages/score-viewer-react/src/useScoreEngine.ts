/**
 * useScoreEngine — load the engine and compute a layout, with React state.
 *
 * Calls `loadEngine()` lazily on first render, caches the singleton in
 * module scope (so multiple `<ScoreView>` instances share one engine),
 * and recomputes the display list whenever the MNX or layout options
 * change.
 *
 * Designed for advanced consumers who want the layout data without the
 * canvas component. For the common case use `<ScoreView>` directly.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Engine,
  loadEngine,
  EngineLoadError,
  ParseError,
  LayoutError,
  type DisplayList,
  type LoadEngineOptions,
  type LayoutOptions,
} from "@viritura/score-engine";

export interface UseScoreEngineResult {
  /** The loaded engine, or null while still loading. */
  engine: Engine | null;
  /** Computed display list, or null until the first successful layout. */
  displayList: DisplayList | null;
  /** Engine load or layout error, if any. */
  error: EngineLoadError | ParseError | LayoutError | null;
  /** True while either the engine or the layout is still computing. */
  loading: boolean;
}

/**
 * React hook: load the score engine and compute a layout.
 *
 * `mnx` may be a JSON string or a parsed object. Pass `null` to skip
 * computation (useful when the score isn't ready yet).
 */
export function useScoreEngine(
  mnx: string | object | null,
  opts: LayoutOptions,
  engineOptions: LoadEngineOptions = {},
): UseScoreEngineResult {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [displayList, setDisplayList] = useState<DisplayList | null>(null);
  const [error, setError] = useState<EngineLoadError | ParseError | LayoutError | null>(null);
  const [loading, setLoading] = useState(true);

  // Load engine once (idempotent inside loadEngine()).
  useEffect(() => {
    let cancelled = false;
    loadEngine(engineOptions)
      .then((e) => {
        if (!cancelled) setEngine(e);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof EngineLoadError ? err : new EngineLoadError(String(err), "unknown"));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [engineOptions.assetBaseUrl]);

  // Recompute layout when engine, mnx, or opts change.
  // We deep-key the opts so callers don't have to memoize.
  const optsKey = useMemo(
    () =>
      [
        opts.pageWidth,
        opts.spatium ?? 7,
        opts.scoreIndex ?? 0,
        opts.pageSetup?.height,
        opts.pageSetup?.margins.top,
        opts.pageSetup?.margins.right,
        opts.pageSetup?.margins.bottom,
        opts.pageSetup?.margins.left,
      ].join("|"),
    [
      opts.pageSetup?.height,
      opts.pageSetup?.margins.bottom,
      opts.pageSetup?.margins.left,
      opts.pageSetup?.margins.right,
      opts.pageSetup?.margins.top,
      opts.pageWidth,
      opts.scoreIndex,
      opts.spatium,
    ],
  );

  useEffect(() => {
    if (!engine || mnx == null) {
      setLoading(engine == null);
      return;
    }
    setLoading(true);
    try {
      const dl = engine.layout(mnx, opts);
      setDisplayList(dl);
      setError(null);
    } catch (err) {
      setError(err as ParseError | LayoutError);
      setDisplayList(null);
    } finally {
      setLoading(false);
    }
  }, [engine, mnx, optsKey]);

  return { engine, displayList, error, loading };
}

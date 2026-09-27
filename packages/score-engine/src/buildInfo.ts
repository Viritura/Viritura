/**
 * Build identity and asset locations.
 *
 * The prebuilt distribution defines `__SCORE_ENGINE_BUNDLE__` (plus version
 * and commit) so the engine finds `wasm/`, `fonts/` and its worker next to the
 * bundle file. Inside Viritura's own apps these are undefined and the host's
 * asset base (Vite `BASE_URL` / `<base>`) applies.
 */

declare const __SCORE_ENGINE_BUNDLE__: boolean | undefined;
declare const __SCORE_ENGINE_COMMIT__: string | undefined;

/** Keep in sync with package.json (asserted by tests). */
export const PACKAGE_VERSION = "0.1.0";

const BUNDLE_WORKER_FILE = "score-engine.worker.js";

export function buildCommit(): string | null {
  return typeof __SCORE_ENGINE_COMMIT__ === "string" && __SCORE_ENGINE_COMMIT__ ? __SCORE_ENGINE_COMMIT__ : null;
}

/** Asset base shipped alongside the prebuilt bundle, if any. */
export function bundledAssetBase(): string | undefined {
  if (typeof __SCORE_ENGINE_BUNDLE__ === "undefined" || !__SCORE_ENGINE_BUNDLE__) return undefined;
  // Held in a variable so app bundlers don't treat the directory as an asset import.
  const moduleUrl = import.meta.url;
  return new URL("./", moduleUrl).href;
}

/**
 * Start the engine's layout worker from its default location. Prebuilt
 * bundles ship the worker beside `wasm/` and `fonts/`, so it follows the
 * asset base when a host serves those files from somewhere else.
 */
export function spawnDefaultLayoutWorker(assetBaseUrl: string): Worker {
  // Checked inline (not via a helper) so the bundle build folds the flag and
  // drops the Vite-only branch below, which app bundlers would try to resolve.
  if (typeof __SCORE_ENGINE_BUNDLE__ !== "undefined" && __SCORE_ENGINE_BUNDLE__) {
    return new Worker(new URL(BUNDLE_WORKER_FILE, assetBaseUrl), { type: "module" });
  }
  return new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
}

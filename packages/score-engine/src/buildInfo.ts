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

function isBundled(): boolean {
  return typeof __SCORE_ENGINE_BUNDLE__ !== "undefined" && __SCORE_ENGINE_BUNDLE__;
}

export function buildCommit(): string | null {
  return typeof __SCORE_ENGINE_COMMIT__ === "string" && __SCORE_ENGINE_COMMIT__ ? __SCORE_ENGINE_COMMIT__ : null;
}

/** Asset base shipped alongside the prebuilt bundle, if any. */
export function bundledAssetBase(): string | undefined {
  return isBundled() ? new URL("./", import.meta.url).href : undefined;
}

/** Start the engine's layout worker from its default location. */
export function spawnDefaultLayoutWorker(): Worker {
  if (isBundled()) {
    // Non-literal URL so app bundlers don't try to resolve the dist-only file.
    return new Worker(new URL(BUNDLE_WORKER_FILE, import.meta.url), { type: "module" });
  }
  return new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
}

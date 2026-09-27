import { loadEngine } from "@viritura/score-viewer-react";
import { SCORE_ENGINE_ASSET_BASE_URL } from "../../scoreEngineAssets";

/**
 * Preload the WASM engine in the background so the first conversion
 * doesn't have to wait for the wasm + font fetch.
 */
export function preloadWasmEngine(): void {
  loadEngine({ assetBaseUrl: SCORE_ENGINE_ASSET_BASE_URL }).catch(() => {
    /* swallow — error is surfaced when the preview mounts */
  });
}

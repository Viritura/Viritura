import { loadEngine } from "@viritura/score-viewer-react";

/**
 * Preload the WASM engine in the background so the first conversion
 * doesn't have to wait for the wasm + font fetch.
 */
export function preloadWasmEngine(): void {
  loadEngine().catch(() => {
    /* swallow — error is surfaced when the preview mounts */
  });
}

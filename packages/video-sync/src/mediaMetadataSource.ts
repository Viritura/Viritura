/**
 * Main-thread adapter for the lazy MediaInfo worker.
 */

import type { DetectedMediaMetadata, MediaMetadataWorkerRequest, MediaMetadataWorkerResponse } from "./mediaMetadata";

export function analyzeMediaMetadata(blob: Blob, signal?: AbortSignal): Promise<DetectedMediaMetadata> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("Media metadata analysis requires Web Worker support."));
  }

  const worker = new Worker(new URL("./mediaMetadataWorker.ts", import.meta.url), { type: "module" });
  const request: MediaMetadataWorkerRequest = { blob };

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };
    const handleAbort = () => {
      cleanup();
      reject(signal?.reason);
    };

    worker.onmessage = (event: MessageEvent<MediaMetadataWorkerResponse>) => {
      cleanup();
      if (event.data.kind === "success") resolve(event.data.metadata);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "The media metadata worker failed."));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage(request);
  });
}

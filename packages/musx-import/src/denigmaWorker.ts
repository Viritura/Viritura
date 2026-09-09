/// <reference lib="webworker" />

import { convertWithDenigma, DenigmaConversionError } from "./denigmaModule";
import type { DenigmaWorkerRequest, DenigmaWorkerResponse } from "./types";

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener("message", ({ data }: MessageEvent<DenigmaWorkerRequest>) => {
  if (data.type !== "convert") return;

  void convertWithDenigma(data.buffer, data.sourceName, data.options)
    .then((result) => {
      const response: DenigmaWorkerResponse = {
        type: "converted",
        requestId: data.requestId,
        result,
      };
      worker.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: DenigmaWorkerResponse = {
        type: "conversion-error",
        requestId: data.requestId,
        message: error instanceof Error ? error.message : String(error),
        diagnostics: error instanceof DenigmaConversionError ? error.diagnostics : [],
      };
      worker.postMessage(response);
    });
});

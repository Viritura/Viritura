import type { HarpPedalCalculation, Score } from "@viritura/core";

export interface CalculationRequest {
  score: Score;
  partIndex: number;
}

export type CalculationResponse = { kind: "result"; result: HarpPedalCalculation } | { kind: "error"; message: string };

export function calculateHarpPedals(
  score: Score,
  partIndex: number,
  signal: AbortSignal,
): Promise<HarpPedalCalculation> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Harp pedal calculation cancelled.", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./calculationWorker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("Harp pedal calculation cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<CalculationResponse>) => {
      cleanup();
      if (event.data.kind === "error") reject(new Error(event.data.message));
      else resolve(event.data.result);
    };
    worker.onerror = (event) => fail(new Error(event.message || "The harp calculation worker failed."));
    worker.onmessageerror = () => fail(new Error("The harp calculation worker returned an unreadable result."));
    try {
      worker.postMessage({ score, partIndex } satisfies CalculationRequest);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

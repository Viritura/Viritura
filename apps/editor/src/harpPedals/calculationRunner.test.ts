import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { calculateHarpPedals, type CalculationResponse } from "./calculationRunner";

class CalculationWorker {
  static instances: CalculationWorker[] = [];
  onmessage: ((event: MessageEvent<CalculationResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    CalculationWorker.instances.push(this);
  }
}

const SCORE: Score = { mnx: { version: 1 }, global: { measures: [] }, parts: [] };

beforeEach(() => {
  CalculationWorker.instances = [];
  vi.stubGlobal("Worker", CalculationWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe("harp calculation worker runner", () => {
  it("resolves complete results and terminates its worker", async () => {
    const result = { solutions: [] };
    const pending = calculateHarpPedals(SCORE, 0, new AbortController().signal);
    const worker = CalculationWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({ score: SCORE, partIndex: 0 });
    worker.onmessage!(new MessageEvent("message", { data: { kind: "result", result } }));
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight worker without resolving provisional results", async () => {
    const controller = new AbortController();
    const pending = calculateHarpPedals(SCORE, 0, controller.signal);
    const worker = CalculationWorker.instances[0]!;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("propagates search failures instead of returning a partial solution", async () => {
    const pending = calculateHarpPedals(SCORE, 0, new AbortController().signal);
    const worker = CalculationWorker.instances[0]!;
    worker.onmessage!(new MessageEvent("message", { data: { kind: "error", message: "Invalid tie target" } }));
    await expect(pending).rejects.toThrow("Invalid tie target");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("propagates worker runtime errors", async () => {
    const pending = calculateHarpPedals(SCORE, 0, new AbortController().signal);
    const worker = CalculationWorker.instances[0]!;
    worker.onerror!(new ErrorEvent("error", { message: "Worker module unavailable" }));
    await expect(pending).rejects.toThrow("Worker module unavailable");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { loadSoundfont } from "../soundfont";
import { exportScoreAudio } from "./index";
import type { AudioRenderRequest, AudioRenderResponse } from "./messages";

vi.mock("../soundfont", () => ({ loadSoundfont: vi.fn() }));

class TestWorker {
  static instances: TestWorker[] = [];
  readonly terminate = vi.fn();
  readonly listeners = new Map<string, EventListener[]>();
  request: AudioRenderRequest | undefined;

  constructor() {
    TestWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(request: AudioRenderRequest, transfer: ArrayBuffer[]): void {
    this.request = structuredClone(request, { transfer });
  }

  emit(data: AudioRenderResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data }));
    }
  }

  emitError(): void {
    const event = Object.assign(new Event("error"), { message: "Worker failed to load" });
    for (const listener of this.listeners.get("error") ?? []) listener(event);
  }
}

const score: Score = { mnx: { version: 1 }, global: { measures: [] }, parts: [] };

beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
  vi.mocked(loadSoundfont).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("audio export worker", () => {
  it("copies the host SoundFont, forwards progress, and returns the worker's result", async () => {
    const soundfont = new Uint8Array([1, 2, 3]).buffer;
    vi.mocked(loadSoundfont).mockResolvedValue(soundfont);
    const onProgress = vi.fn();
    const mix = [{ volume: 0.4, pan: -0.5, muted: true, ensembleEnabled: false }];
    const result = exportScoreAudio(score, { format: "wav", bitDepth: 24 }, { onProgress, mix });
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    const worker = TestWorker.instances[0]!;

    expect(soundfont.byteLength).toBe(3);
    expect(worker.request?.soundfont).toEqual(soundfont);
    expect(worker.request?.mix).toEqual(mix);
    expect(worker.request?.encoding).toEqual({ format: "wav", bitDepth: 24 });
    worker.emit({ type: "progress", fraction: 0.4 });
    worker.emit({ type: "complete", bytes: new Uint8Array([4, 5]).buffer, warnings: ["A warning"] });

    await expect(result).resolves.toEqual({ bytes: new Uint8Array([4, 5]), warnings: ["A warning"] });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0.4);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancels while the sound library is loading without starting a worker", async () => {
    vi.mocked(loadSoundfont).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const result = exportScoreAudio(score, { format: "wav", bitDepth: 24 }, { signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();

    await rejection;
    expect(TestWorker.instances).toHaveLength(0);
  });

  it("terminates a running worker when cancelled", async () => {
    const controller = new AbortController();
    const result = exportScoreAudio(score, { format: "wav", bitDepth: 24 }, { signal: controller.signal });
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();

    await rejection;
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });

  it("surfaces worker startup failures", async () => {
    const result = exportScoreAudio(score, { format: "mp3", bitrate: 192 });
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    const rejection = expect(result).rejects.toThrow("Worker failed to load");
    TestWorker.instances[0]!.emitError();

    await rejection;
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
});

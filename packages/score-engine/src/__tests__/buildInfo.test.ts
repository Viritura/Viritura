import { afterEach, describe, expect, it, vi } from "vitest";
import { bundledAssetBase, spawnDefaultLayoutWorker } from "../buildInfo";

class RecordingWorker {
  static urls: string[] = [];
  constructor(url: string | URL) {
    RecordingWorker.urls.push(String(url));
  }
}

describe("prebuilt bundle asset locations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    RecordingWorker.urls = [];
  });

  it("uses the host's asset base inside Viritura's own apps", () => {
    expect(bundledAssetBase()).toBeUndefined();
  });

  it("loads the worker from the asset base, so self-hosted assets move it too", () => {
    vi.stubGlobal("__SCORE_ENGINE_BUNDLE__", true);
    vi.stubGlobal("Worker", RecordingWorker);
    spawnDefaultLayoutWorker("https://cdn.example.com/vendor/score-engine/");
    expect(RecordingWorker.urls).toEqual(["https://cdn.example.com/vendor/score-engine/score-engine.worker.js"]);
  });

  it("defaults the asset base to the bundle's own directory", () => {
    vi.stubGlobal("__SCORE_ENGINE_BUNDLE__", true);
    expect(bundledAssetBase()).toBe(new URL("./", new URL("../buildInfo.ts", import.meta.url)).href);
  });
});

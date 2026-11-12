import { afterEach, describe, expect, it, vi } from "vitest";
import { getGlobalPerfTracker, getWasmMemoryBytes } from "@viritura/renderer";
import { createDocumentStore } from "../store/documentStore";
import { readMemorySample } from "./browserSample";

const originalMemory = Object.getOwnPropertyDescriptor(performance, "memory");

afterEach(() => {
  if (originalMemory) Object.defineProperty(performance, "memory", originalMemory);
  else Reflect.deleteProperty(performance, "memory");
  document.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
  Reflect.deleteProperty(window, "__VIRITURA_LAYOUT_MEMORY__");
  vi.restoreAllMocks();
});

describe("memory snapshot collection", () => {
  it("reports unsupported memory as null and only copies numeric document metadata", () => {
    Object.defineProperty(performance, "memory", { configurable: true, value: undefined });
    const state = createDocumentStore().getState();
    const snapshot = readMemorySample({
      ...state,
      fileName: "private-name.mnx",
      mnxJson: "private score contents",
    });
    expect(snapshot.heapUsedBytes).toBeNull();
    expect(snapshot.heapLimitBytes).toBeNull();
    expect(snapshot.workerWasmBytes).toBeNull();
    expect(snapshot.mainWasmBytes).toBe(getWasmMemoryBytes());
    expect(snapshot.mnxCharacters).toBe("private score contents".length);
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("captures heap, cached worker capacity, actual canvas dimensions, and retained tile estimates", () => {
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: { usedJSHeapSize: 12345, jsHeapSizeLimit: 99999 },
    });
    Object.assign(window, {
      __VIRITURA_LAYOUT_MEMORY__: { bytes: 65536, sampledAt: Date.now() - 15000 },
    });
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    document.body.appendChild(canvas);
    const tracker = getGlobalPerfTracker();
    const previousTileBytes = tracker.retainedTileBytes;
    tracker.retainedTileBytes = 8192;
    try {
      const snapshot = readMemorySample(createDocumentStore().getState());
      expect(snapshot).toMatchObject({
        heapUsedBytes: 12345,
        heapLimitBytes: 99999,
        workerWasmBytes: 65536,
        canvasCount: 1,
        canvasPixelBytes: 80000,
        retainedTileBytes: 8192,
      });
      expect(snapshot.workerSampleAgeMs).toBeGreaterThanOrEqual(15000);
    } finally {
      tracker.retainedTileBytes = previousTileBytes;
    }
  });
});

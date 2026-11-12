import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDiagnostics, MemoryDiagnosticsSettings } from "./MemoryDiagnostics";
import { readSavedMemoryReport, saveMemoryReport } from "./reportStorage";
import { MemoryRecorder, type MemorySample } from "./recorder";
import { readMemorySample } from "./browserSample";
import { toast } from "sonner";

vi.mock("../store/DocumentContext", () => {
  const store = { getState: () => ({}) };
  return { useDocumentStoreApi: () => store };
});
vi.mock("./browserSample", () => ({ readMemorySample: vi.fn() }));
const playback = vi.hoisted(() => ({
  listener: null as ((status: string) => void) | null,
  subscriptions: 0,
  unsubscribe: vi.fn(),
}));
vi.mock("@viritura/playback", () => ({
  subscribePlaybackStatus: (listener: (status: string) => void) => {
    playback.listener = listener;
    playback.subscriptions++;
    return playback.unsubscribe;
  },
}));
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function sample(): MemorySample {
  return {
    timestamp: Date.now(),
    uptimeMs: 1000,
    heapUsedBytes: 1600 * 1024 * 1024,
    heapLimitBytes: 2 ** 32,
    mainWasmBytes: null,
    workerWasmBytes: null,
    workerSampleAgeMs: null,
    liveSynths: 0,
    soundBankBytes: 0,
    playbackStatus: "stopped",
    zoom: 1,
    canvasCount: 1,
    canvasPixelBytes: 100,
    parts: 4,
    measures: 200,
    mnxCharacters: 10000,
    dirty: true,
    documentGeneration: 1,
    tilesCached: 10,
    tilesRendered: 0,
    retainedTileBytes: 1024,
    renderCommandCount: 200,
    layoutMs: 20,
    serializeMs: 1,
    hidden: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(readMemorySample).mockImplementation(sample);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local memory diagnostics", () => {
  it("persists a warning before notifying and keeps it through later checkpoints", () => {
    const view = render(<MemoryDiagnostics />);
    act(() => vi.advanceTimersByTime(20000));
    const saved = readSavedMemoryReport();
    expect(saved).toContain('"reason":"high-memory"');
    expect(saved).not.toContain("fileName");
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("memory use"),
      expect.objectContaining({ action: expect.objectContaining({ label: "Download diagnostics" }) }),
    );
    act(() => vi.advanceTimersByTime(60000));
    fireEvent(document, new Event("visibilitychange"));
    expect(readSavedMemoryReport()).toBe(saved);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(readMemorySample).mockClear();
    fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(60000));
    expect(readMemorySample).not.toHaveBeenCalled();
  });

  it("offers a saved report on remount and allows manual downloads", () => {
    const recorder = new MemoryRecorder("test");
    recorder.sample(sample());
    saveMemoryReport(recorder.report("high-memory"));
    const createUrl = vi.fn(() => "blob:test");
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createUrl;
        static revokeObjectURL = revokeUrl;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const view = render(
        <>
          <MemoryDiagnostics />
          <MemoryDiagnosticsSettings />
        </>,
      );
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining("earlier session"),
        expect.objectContaining({ action: expect.objectContaining({ label: "Download saved report" }) }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Download diagnostics", exact: true }));
      fireEvent.click(screen.getByRole("button", { name: "Download saved report", exact: true }));
      expect(createUrl).toHaveBeenCalledTimes(2);
      expect(revokeUrl).toHaveBeenCalledTimes(2);
      expect(click).toHaveBeenCalledTimes(2);
      expect(document.querySelector("a[download]")).toBeNull();
      view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("records playback and visibility markers in saved checkpoints", () => {
    playback.subscriptions = 0;
    const view = render(<MemoryDiagnostics />);
    act(() => {
      playback.listener?.("playing");
      playback.listener?.("stopped");
    });
    fireEvent(document, new Event("visibilitychange"));
    const saved = JSON.parse(readSavedMemoryReport() ?? "null") as { markers: { kind: string }[] };
    expect(saved.markers.map((marker) => marker.kind)).toEqual(["playing", "stopped", "visible"]);
    view.unmount();
    expect(playback.subscriptions).toBeGreaterThan(0);
    expect(playback.unsubscribe).toHaveBeenCalledTimes(playback.subscriptions);
  });

  it("continues monitoring when local storage is unavailable and surfaces the failure", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    const view = render(<MemoryDiagnostics />);
    act(() => vi.advanceTimersByTime(20000));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("storage is unavailable"), expect.any(Error));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("cannot be saved locally"));
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("memory use"), expect.any(Object));
    view.unmount();
  });
});

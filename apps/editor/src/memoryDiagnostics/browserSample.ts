import { getGlobalPerfTracker, getWasmMemoryBytes } from "@viritura/renderer";
import type { DocumentStoreState } from "../store/documentStore";
import type { MemorySample } from "./recorder";

interface BrowserMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function validBytes(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readMemorySample(state: DocumentStoreState): MemorySample {
  const timestamp = Date.now();
  const memory = (performance as Performance & { memory?: BrowserMemory }).memory;
  const worker = (
    window as Window & { __VIRITURA_LAYOUT_MEMORY__?: { bytes: number | null; sampledAt: number } | null }
  ).__VIRITURA_LAYOUT_MEMORY__;
  const canvases = document.querySelectorAll("canvas");
  let canvasPixelBytes = 0;
  for (const canvas of canvases) canvasPixelBytes += canvas.width * canvas.height * 4;
  const perf = getGlobalPerfTracker();
  return {
    timestamp,
    heapUsedBytes: validBytes(memory?.usedJSHeapSize),
    heapLimitBytes: validBytes(memory?.jsHeapSizeLimit),
    mainWasmBytes: getWasmMemoryBytes(),
    workerWasmBytes: worker?.bytes ?? null,
    workerSampleAgeMs: worker ? Math.max(0, timestamp - worker.sampledAt) : null,
    canvasCount: canvases.length,
    canvasPixelBytes,
    parts: state.score?.parts.length ?? 0,
    measures: state.score?.global.measures.length ?? 0,
    mnxCharacters: state.mnxJson.length,
    dirty: state.dirty,
    documentGeneration: state.documentGeneration,
    tilesCached: perf.tilesCached,
    tilesRendered: perf.tilesRendered,
    retainedTileBytes: perf.retainedTileBytes,
    renderCommandCount: perf.renderCommandCount,
    layoutMs: perf.wasmLayoutMs,
    serializeMs: perf.serializeMs,
    hidden: document.hidden,
  };
}

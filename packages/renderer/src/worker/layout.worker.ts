/**
 * Layout Web Worker entry point.
 *
 * Hosts the WASM module and a single retained-score {@link CachedLayoutEngine}
 * so all layout/parse/serialize work runs off the editor's main thread. The
 * public surface is {@link LayoutWorkerApi}, exposed via Comlink.
 *
 * Only `wasm.ts` (+ its narrow deps) is imported here — never the canvas/painter
 * code, which references `document`/`OffscreenCanvas` and has no place in this
 * compute-only worker.
 */

import * as Comlink from "comlink";
import { setAssetBasePath } from "../basePath";
import {
  initWasm,
  isWasmReady,
  getScoreInfo,
  computeMnxScoreLayout,
  computeMnxScoreLayoutBinary,
  createCachedLayoutEngine,
  setEmitLayoutDebug,
  setWasmTiming,
  type CachedLayoutEngine,
} from "../wasm";
import type { LayoutWorkerApi } from "./layoutWorkerApi";
import { EngineOperationQueue } from "./engineOperationQueue";

let engine: CachedLayoutEngine | null = null;
const engineOperations = new EngineOperationQueue();

function requireEngine(): CachedLayoutEngine {
  if (!engine) {
    throw new Error("Layout worker not initialized. Call init() first.");
  }
  return engine;
}

function runEngine<T>(operation: (current: CachedLayoutEngine) => T): Promise<T> {
  return engineOperations.run(() => operation(requireEngine()));
}

const api: LayoutWorkerApi = {
  async init(basePath, emitLayoutDebug) {
    setAssetBasePath(basePath);
    await initWasm();
    if (!isWasmReady()) return false;
    setEmitLayoutDebug(emitLayoutDebug);
    if (!engine) {
      engine = createCachedLayoutEngine();
    }
    return true;
  },

  isReady() {
    return isWasmReady() && engine !== null;
  },

  setEmitLayoutDebug(enabled) {
    setEmitLayoutDebug(enabled);
  },

  getScoreInfo(mnxJson) {
    return getScoreInfo(mnxJson);
  },

  computeMnxScoreLayout(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson) {
    return computeMnxScoreLayout(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson);
  },

  computeMnxScoreLayoutBinary(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson) {
    const binary = computeMnxScoreLayoutBinary(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson);
    return Comlink.transfer(binary, [binary.buffer]);
  },

  engineComputeLayout(mnxJson, partIndex, spatium, pageWidth, pageSetupJson) {
    return runEngine((current) => current.computeLayout(mnxJson, partIndex, spatium, pageWidth, pageSetupJson));
  },

  engineComputeFullScoreLayout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) =>
      current.computeFullScoreLayout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex),
    );
  },

  engineComputeFullScoreLayoutBinary(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) => {
      const binary = current.computeFullScoreLayoutBinary(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex);
      return Comlink.transfer(binary, [binary.buffer]);
    });
  },

  engineRelayoutRetainedScore(spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) => current.relayoutRetainedScore(spatium, pageWidth, pageSetupJson, scoreIndex));
  },

  engineRelayoutRetainedScoreBinary(spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) => {
      const binary = current.relayoutRetainedScoreBinary(spatium, pageWidth, pageSetupJson, scoreIndex);
      if (!binary) return null;
      return Comlink.transfer(binary, [binary.buffer]);
    });
  },

  engineApplyPatchAndLayout(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) =>
      current.applyPatchAndLayout(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex),
    );
  },

  engineApplyPatchAndLayoutBinary(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) => {
      const binary = current.applyPatchAndLayoutBinary(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex);
      return Comlink.transfer(binary, [binary.buffer]);
    });
  },

  engineApplyPatchAndLayoutPatchFrameBinary(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) => {
      const binary = current.applyPatchAndLayoutPatchFrameBinary(
        patchJson,
        spatium,
        pageWidth,
        pageSetupJson,
        scoreIndex,
      );
      return Comlink.transfer(binary, [binary.buffer]);
    });
  },

  engineFullLayout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex) {
    return runEngine((current) => current.fullLayout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex));
  },

  engineInvalidateCache() {
    return runEngine((current) => current.invalidateCache());
  },

  engineCacheStats() {
    return runEngine((current) => current.cacheStats());
  },

  engineLayoutMetrics() {
    return runEngine((current) => current.layoutMetrics());
  },

  engineSetTiming(enabled) {
    return runEngine(() => setWasmTiming(enabled));
  },

  engineTakeTimings() {
    return runEngine((current) => current.takeTimings());
  },

  engineHasRetainedScore() {
    return engineOperations.run(() => engine !== null && engine.hasRetainedScore());
  },
};

Comlink.expose(api);

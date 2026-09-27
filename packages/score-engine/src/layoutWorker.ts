/// <reference lib="webworker" />
/**
 * Layout worker: runs the WASM layout engine off the main thread and
 * transfers the packed binary display list back zero-copy.
 */

import {
  getWasmInitError,
  initWasm,
  isWasmReady,
  setAssetBasePath,
  wasmComputeMnxScoreLayoutBinary,
} from "@viritura/renderer";
import { messageOf } from "./layoutRequest";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./layoutWorkerProtocol";

declare const self: DedicatedWorkerGlobalScope;

let ready: Promise<void> | null = null;

async function ensureEngine(assetBaseUrl: string): Promise<void> {
  setAssetBasePath(assetBaseUrl);
  await initWasm();
  if (!isWasmReady()) throw new Error(messageOf(getWasmInitError() ?? "WASM engine failed to load"));
}

function reply(message: LayoutWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<LayoutWorkerRequest>) => {
  const req = event.data;
  if (req.type === "init") {
    ready = ensureEngine(req.assetBaseUrl);
    ready.then(
      () => reply({ id: req.id, ok: true }),
      (err: unknown) => {
        ready = null;
        reply({ id: req.id, ok: false, kind: "load", message: messageOf(err) });
      },
    );
    return;
  }
  try {
    if (!ready) throw new Error("Layout worker used before init");
    await ready;
    const { json, spatium, pageWidth, scoreIndex, pageSetupJson } = req.args;
    const packed = wasmComputeMnxScoreLayoutBinary(json, spatium, pageWidth, scoreIndex, pageSetupJson);
    // Copy out of WASM memory into a standalone, transferable buffer.
    const data = new Float32Array(packed);
    reply({ id: req.id, ok: true, data }, [data.buffer]);
  } catch (err) {
    reply({ id: req.id, ok: false, kind: "layout", message: messageOf(err) });
  }
};

import { decodeBinaryDisplayList } from "@viritura/renderer";
import { spawnDefaultLayoutWorker } from "./buildInfo";
import { wrapDisplayList } from "./displayListHandle";
import { EngineLoadError, LayoutError } from "./errors";
import { layoutArgs, layoutFailure } from "./layoutRequest";
import type { LayoutWorkerCommand, LayoutWorkerRequest, LayoutWorkerResponse } from "./layoutWorkerProtocol";
import type { DisplayList, LayoutOptions, LayoutWorker, LayoutWorkerOptions } from "./types";

interface Pending {
  resolve(data: Float32Array | undefined): void;
  reject(err: Error): void;
}

export function createLayoutWorker(assetBaseUrl: string, opts: LayoutWorkerOptions = {}): LayoutWorker {
  const worker = opts.url ? new Worker(opts.url, { type: "module" }) : spawnDefaultLayoutWorker();
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let disposed = false;

  const failAll = (err: Error): void => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
    const res = event.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.data);
    else if (res.kind === "load") p.reject(new EngineLoadError(`Layout worker failed to load: ${res.message}`, "wasm"));
    else p.reject(layoutFailure(new Error(res.message)));
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    failAll(new EngineLoadError(`Layout worker error: ${event.message || "script failed to load"}`, "wasm", event));
  };

  const send = (command: LayoutWorkerCommand): Promise<Float32Array | undefined> => {
    if (disposed) return Promise.reject(new LayoutError("Layout worker has been disposed", "unknown"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const request: LayoutWorkerRequest = { ...command, id };
      worker.postMessage(request);
    });
  };

  const ready = send({ type: "init", assetBaseUrl });
  // Surface init failures through layout() rather than as unhandled rejections.
  ready.catch(() => undefined);

  return {
    async layout(mnx: string | object, layoutOpts: LayoutOptions): Promise<DisplayList> {
      const args = layoutArgs(mnx, layoutOpts);
      await ready;
      const data = await send({ type: "layout", args });
      if (!data) throw new LayoutError("Layout worker returned no data", "unknown");
      return wrapDisplayList(decodeBinaryDisplayList(data));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      failAll(new LayoutError("Layout worker has been disposed", "unknown"));
    },
  };
}

import type {
  DenigmaWorkerFailure,
  DenigmaWorkerRequest,
  DenigmaWorkerResponse,
  MusxImportOptions,
  MusxImportResult,
} from "./types";
import { MAX_MUSX_BYTES } from "./archiveLimits";

interface PendingConversion {
  resolve: (result: MusxImportResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  worker: Worker;
}

export interface MusxImporter {
  convert(source: ArrayBuffer | Uint8Array, sourceName: string, options?: MusxImportOptions): Promise<MusxImportResult>;
  terminate(): void;
}

function conversionError(response: DenigmaWorkerFailure): Error {
  const details = response.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.message);
  return new Error(details.length > 0 ? details.join("; ") : response.message);
}

export function createMusxImporter(
  createWorker: () => Worker = () =>
    new Worker(new URL("./denigmaWorker.ts", import.meta.url), {
      type: "module",
      name: "denigma-musx-import",
    }),
): MusxImporter {
  let worker: Worker | undefined;
  let nextRequestId = 1;
  const pending = new Map<number, PendingConversion>();

  const failWorker = (failedWorker: Worker, error: Error): void => {
    if (worker === failedWorker) worker = undefined;
    failedWorker.terminate();
    for (const [requestId, request] of pending) {
      if (request.worker !== failedWorker) continue;
      pending.delete(requestId);
      clearTimeout(request.timeout);
      request.reject(error);
    }
  };

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    const createdWorker = createWorker();
    worker = createdWorker;
    createdWorker.addEventListener("message", ({ data }: MessageEvent<DenigmaWorkerResponse>) => {
      const request = pending.get(data.requestId);
      if (!request || request.worker !== createdWorker) return;
      pending.delete(data.requestId);
      clearTimeout(request.timeout);
      if (data.type === "converted") {
        request.resolve(data.result);
      } else {
        request.reject(conversionError(data));
      }
    });
    createdWorker.addEventListener("error", (event) => {
      failWorker(createdWorker, new Error(event.message || "The Denigma import worker failed."));
    });
    return createdWorker;
  };

  return {
    convert(source, sourceName, options = {}) {
      if (source.byteLength > MAX_MUSX_BYTES) {
        return Promise.reject(new Error("MUSX input exceeds the 64 MiB safety limit."));
      }
      const requestId = nextRequestId++;
      return new Promise<MusxImportResult>((resolve, reject) => {
        const requestedTimeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 120_000;
        const timeoutMs = Math.max(1, Math.min(requestedTimeout, 120_000));
        const activeWorker = ensureWorker();
        const timeout = setTimeout(() => {
          failWorker(activeWorker, new Error(`Denigma conversion exceeded the ${timeoutMs} ms safety limit.`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timeout, worker: activeWorker });
        try {
          const bytes = source instanceof Uint8Array ? Uint8Array.from(source).buffer : source.slice(0);
          const request: DenigmaWorkerRequest = {
            type: "convert",
            requestId,
            sourceName,
            buffer: bytes,
            options,
          };
          activeWorker.postMessage(request, [bytes]);
        } catch (error) {
          failWorker(activeWorker, error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    terminate() {
      const error = new Error("The Denigma importer was terminated.");
      if (worker) {
        failWorker(worker, error);
      } else {
        for (const request of pending.values()) {
          clearTimeout(request.timeout);
          request.reject(error);
        }
        pending.clear();
      }
    },
  };
}

export async function convertMusxToMnx(
  source: ArrayBuffer | Uint8Array,
  sourceName: string,
  options?: MusxImportOptions,
): Promise<MusxImportResult> {
  const importer = createMusxImporter();
  try {
    return await importer.convert(source, sourceName, options);
  } finally {
    importer.terminate();
  }
}

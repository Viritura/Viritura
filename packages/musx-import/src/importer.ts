import type {
  DenigmaWorkerFailure,
  DenigmaWorkerRequest,
  DenigmaWorkerResponse,
  MusxImportOptions,
  MusxImportResult,
} from "./types";

interface PendingConversion {
  resolve: (result: MusxImportResult) => void;
  reject: (error: Error) => void;
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

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    worker = createWorker();
    worker.addEventListener("message", ({ data }: MessageEvent<DenigmaWorkerResponse>) => {
      const request = pending.get(data.requestId);
      if (!request) return;
      pending.delete(data.requestId);
      if (data.type === "converted") {
        request.resolve(data.result);
      } else {
        request.reject(conversionError(data));
      }
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "The Denigma import worker failed.");
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      worker?.terminate();
      worker = undefined;
    });
    return worker;
  };

  return {
    convert(source, sourceName, options = {}) {
      const bytes = source instanceof Uint8Array ? Uint8Array.from(source).buffer : source.slice(0);
      const requestId = nextRequestId++;
      const request: DenigmaWorkerRequest = {
        type: "convert",
        requestId,
        sourceName,
        buffer: bytes,
        options,
      };
      return new Promise<MusxImportResult>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        try {
          ensureWorker().postMessage(request, [bytes]);
        } catch (error) {
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    terminate() {
      worker?.terminate();
      worker = undefined;
      const error = new Error("The Denigma importer was terminated.");
      for (const request of pending.values()) request.reject(error);
      pending.clear();
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

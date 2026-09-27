import type { Uri } from "monaco-editor";
import type { JsonValidationWorker, MonacoApi } from "../types";

const MNX_SCHEMA_URI = "https://mnx.formats.music/docs/mnx-schema.json";
const WORKER_STARTUP_TIMEOUT_MS = 10_000;
const WORKER_RETRY_INTERVAL_MS = 50;
const schemaPromises = new Map<string, Promise<Record<string, unknown>>>();

export function loadMnxSchema(schemaUrl: string): Promise<Record<string, unknown>> {
  let promise = schemaPromises.get(schemaUrl);
  if (!promise) {
    promise = fetch(schemaUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to load the MNX schema (${response.status} ${response.statusText})`);
      }
      return response.json() as Promise<Record<string, unknown>>;
    });
    void promise.catch(() => schemaPromises.delete(schemaUrl));
    schemaPromises.set(schemaUrl, promise);
  }
  return promise;
}

export function configureMnxDiagnostics(monaco: MonacoApi, schema: Record<string, unknown>): void {
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    trailingCommas: "error",
    enableSchemaRequest: false,
    schemaValidation: "error",
    schemas: [{ uri: MNX_SCHEMA_URI, fileMatch: ["*.mnx"], schema }],
  });
}

export async function getMnxValidationWorker(monaco: MonacoApi, uri: Uri): Promise<JsonValidationWorker> {
  const deadline = Date.now() + WORKER_STARTUP_TIMEOUT_MS;
  while (true) {
    try {
      const workerAccessor = await monaco.json.getWorker();
      return await workerAccessor(uri);
    } catch (error) {
      if (error !== "JSON not registered!" || Date.now() >= deadline) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, WORKER_RETRY_INTERVAL_MS));
    }
  }
}

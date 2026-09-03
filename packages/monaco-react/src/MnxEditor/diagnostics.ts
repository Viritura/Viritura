import type { MonacoApi } from "../types";

const MNX_SCHEMA_URI = "https://w3c.github.io/mnx/docs/mnx-schema.json";
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

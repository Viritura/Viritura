import type { Monaco } from "@monaco-editor/react";

const MNX_SCHEMA_URI = "https://w3c.github.io/mnx/docs/mnx-schema.json";
const FILE_MATCH = ["*"];

let schemaPromise: Promise<Record<string, unknown> | null> | null = null;

export function configureMnxJsonDiagnostics(monaco: Monaco, schema?: Record<string, unknown> | null): void {
  const schemas = schema
    ? [{ uri: MNX_SCHEMA_URI, fileMatch: FILE_MATCH, schema }]
    : [{ uri: MNX_SCHEMA_URI, fileMatch: FILE_MATCH }];

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    trailingCommas: "error",
    enableSchemaRequest: true,
    schemaValidation: "error",
    schemas,
  });
}

export function loadMnxSchema(): Promise<Record<string, unknown> | null> {
  if (!schemaPromise) {
    schemaPromise = fetch(`${import.meta.env.BASE_URL}mnx-schema.json`)
      .then((response) => {
        if (!response.ok) {
          return null;
        }
        return response.json() as Promise<Record<string, unknown>>;
      })
      .catch(() => null);
  }

  return schemaPromise;
}

import type { BeforeMount } from "@viritura/monaco-react";

type Monaco = Parameters<BeforeMount>[0];

const MNX_SCHEMA_URI = "https://w3c.github.io/mnx/docs/mnx-schema.json";
const PLAYGROUND_MODEL_URI = "file:///playground.mnx";

let schemaPromise: Promise<Record<string, unknown> | null> | null = null;

function loadMnxSchema(): Promise<Record<string, unknown> | null> {
  schemaPromise ??= fetch("/mnx-schema.json")
    .then((response) => (response.ok ? (response.json() as Promise<Record<string, unknown>>) : null))
    .catch(() => null);
  return schemaPromise;
}

function setDiagnostics(monaco: Monaco, schema: Record<string, unknown> | null): void {
  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    trailingCommas: "error",
    enableSchemaRequest: true,
    schemaValidation: "error",
    schemas: schema
      ? [{ uri: MNX_SCHEMA_URI, fileMatch: [PLAYGROUND_MODEL_URI, "*.mnx"], schema }]
      : [{ uri: MNX_SCHEMA_URI, fileMatch: [PLAYGROUND_MODEL_URI, "*.mnx"] }],
  });
}

export function configureMnxDiagnostics(monaco: Monaco): void {
  setDiagnostics(monaco, null);
  void loadMnxSchema().then((schema) => setDiagnostics(monaco, schema));
}

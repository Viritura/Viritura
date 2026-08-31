import { createHash } from "node:crypto";

export interface MnxSchemaSourceLock {
  upstreamRepository: string;
  upstreamCommit: string;
  upstreamPath: string;
  upstreamBlob: string;
  schemaId: string;
  canonicalSha256: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

export function canonicalSha256(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function parseJson(text: string, label: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

export function assertSourceLock(value: JsonValue): asserts value is MnxSchemaSourceLock & JsonValue {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("MNX schema source lock must be an object");
  }
  for (const field of [
    "upstreamRepository",
    "upstreamCommit",
    "upstreamPath",
    "upstreamBlob",
    "schemaId",
    "canonicalSha256",
  ] as const) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`MNX schema source lock is missing '${field}'`);
    }
  }
}

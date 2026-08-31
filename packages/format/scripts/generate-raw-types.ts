#!/usr/bin/env node
/**
 * Generate Raw MNX TypeScript types from mnx-schema.json.
 *
 * Strategy: wrap the MNX JSON Schema (Draft 2020-12) as an OpenAPI 3.1
 * components.schemas block — OpenAPI 3.1 schemas ARE JSON Schema 2020-12 —
 * then feed it to openapi-typescript. The OpenAPI wrapper gives us:
 *   - Proper discriminated unions from `oneOf` + `const` (kept as `A | B | C`)
 *   - Recursion handling via `components["schemas"][...]` indirection
 *   - allOf+$ref extension pattern handled via TS intersection (`A & B`)
 *   - Required vs optional preserved from the schema
 *   - No `[k: string]: unknown` index signatures
 *
 * Output: packages/core/src/raw/raw.ts containing the openapi-typescript
 * output plus auto-generated PascalCase aliases for ergonomic consumption.
 * Raw types live in @viritura/core because the decoded model derives from
 * them; format would create a dependency cycle if it owned them.
 *
 * To regenerate:  pnpm gen:raw
 * To verify in CI: pnpm gen:raw:check  (fails if generated file is stale)
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type JsonObject = { [k: string]: JsonValue };

const here = import.meta.dirname;
const schemaPath = resolve(here, "../schemas/mnx-schema.json");
const outPath = resolve(here, "../../core/src/raw/raw.ts");
const schemaCopyPath = resolve(here, "../../core/src/raw/mnx-schema.json");

const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as JsonObject;

// Rewrite #/$defs/foo → #/components/schemas/foo throughout the schema tree.
function rewriteRefs(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (node && typeof node === "object") {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string" && v.startsWith("#/$defs/")) {
        out[k] = v.replace("#/$defs/", "#/components/schemas/");
      } else {
        out[k] = rewriteRefs(v);
      }
    }
    return out;
  }
  return node;
}

const defs = rewriteRefs((schema.$defs as JsonObject) ?? {}) as JsonObject;
const root = rewriteRefs({ ...schema }) as JsonObject;
delete root.$defs;
delete root.$schema;
delete root.$id;

// Root type name (the schema's top-level shape). We use a fixed name rather
// than deriving from schema.title so renames in the spec don't churn the API.
const rootName = "MnxDocument";

const openapi = {
  openapi: "3.1.0",
  info: { title: "MNX (auto-wrapped for codegen)", version: "1.0.0" },
  paths: {},
  components: {
    schemas: {
      [rootName]: root,
      ...defs,
    },
  },
};

const ast = await openapiTS(openapi as Parameters<typeof openapiTS>[0]);
const ts = astToString(ast);

// Build PascalCase aliases for every schema key so consumers can write
// `import type { SequenceContent } from "..."` instead of
// `components["schemas"]["sequence-content"]`.
const schemaKeys = Object.keys(openapi.components.schemas);
const aliases = schemaKeys
  .map((key) => {
    const pascal = toPascalCase(key);
    return `export type ${pascal} = components["schemas"][${JSON.stringify(key)}];`;
  })
  .join("\n");

const banner = [
  "/* eslint-disable -- auto-generated; edit mnx-schema.json + run pnpm gen:raw */",
  "// AUTO-GENERATED FROM packages/format/schemas/mnx-schema.json — DO NOT EDIT BY HAND.",
  "// Regenerate with:  pnpm --filter @viritura/format gen:raw",
  "// These are wire-shape types (1:1 with the MNX JSON schema). Use promote.ts",
  "// to convert to the decoded Score model in @viritura/core.",
  "",
].join("\n");

const aliasSection = [
  "",
  "// ─── PascalCase aliases ─────────────────────────────────────────────",
  "// Auto-generated convenience aliases for every $def in mnx-schema.json.",
  aliases,
  "",
].join("\n");

const final = banner + ts + aliasSection;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, final);
console.log(`Wrote ${outPath} (${final.split("\n").length} lines, ${schemaKeys.length} schemas)`);

// Also copy the source schema next to the generated types so the runtime
// validator (src/mnx/validator.ts) can import it without reaching outside
// the format package. The two artifacts are derived from the same source
// (packages/format/schemas/mnx-schema.json) and stay in lock-step via
// `pnpm gen:raw`.
copyFileSync(schemaPath, schemaCopyPath);
console.log(`Copied ${schemaPath} → ${schemaCopyPath}`);

function toPascalCase(s: string): string {
  // "sequence-content" → "SequenceContent"
  // "global-attrs" → "GlobalAttrs"
  // "1-letter" → "_1Letter" (avoid identifiers starting with a digit)
  const parts = s.split(/[-_/]/).filter(Boolean);
  let out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  if (/^\d/.test(out)) out = "_" + out;
  return out;
}

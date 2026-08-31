#!/usr/bin/env node
/**
 * Generate TypeScript types for the Viritura vendor extension schema
 * (`packages/format/schemas/viritura-extensions.json`).
 *
 * Mirrors `generate-raw-types.ts` (which targets `mnx-schema.json`) so that
 * the TS wire layer for `_x.viritura` payloads has the same compile-time
 * coverage as the Rust side (`engine/viritura-engine/src/raw_viritura.rs`,
 * codegen'd by `engine/viritura-codegen`).
 *
 * Output: `packages/core/src/raw/raw-viritura.ts` containing the
 * openapi-typescript output plus PascalCase aliases for every `$def`.
 * Lives in @viritura/core for the same reason as raw.ts — see that file.
 *
 * To regenerate:    pnpm gen:raw-viritura
 * To verify in CI:  pnpm gen:raw-viritura:check
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
type JsonObject = { [k: string]: JsonValue };

const here = import.meta.dirname;
const schemaPath = resolve(here, "../schemas/viritura-extensions.json");
const outPath = resolve(here, "../../core/src/raw/raw-viritura.ts");

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

const openapi = {
  openapi: "3.1.0",
  info: { title: "Viritura MNX Vendor Extensions (auto-wrapped for codegen)", version: "1.0.0" },
  paths: {},
  components: {
    schemas: defs,
  },
};

const ast = await openapiTS(openapi as Parameters<typeof openapiTS>[0]);
const ts = astToString(ast);

const schemaKeys = Object.keys(defs);
const aliases = schemaKeys
  .map((key) => {
    const pascal = toPascalCase(key);
    return `export type ${pascal} = components["schemas"][${JSON.stringify(key)}];`;
  })
  .join("\n");

const banner = [
  "/* eslint-disable -- auto-generated; edit viritura-extensions.json + run pnpm gen:raw-viritura */",
  "// AUTO-GENERATED FROM packages/format/schemas/viritura-extensions.json — DO NOT EDIT BY HAND.",
  "// Regenerate with:  pnpm --filter @viritura/format gen:raw-viritura",
  "// These are wire-shape types for `_x.viritura` payloads (1:1 with the",
  "// extensions schema). The Rust counterpart lives at",
  "// engine/viritura-engine/src/raw_viritura.rs.",
  "",
].join("\n");

const aliasSection = [
  "",
  "// ─── PascalCase aliases ─────────────────────────────────────────────",
  "// Auto-generated convenience aliases for every $def in viritura-extensions.json.",
  aliases,
  "",
].join("\n");

const final = banner + ts + aliasSection;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, final);
console.log(`Wrote ${outPath} (${final.split("\n").length} lines, ${schemaKeys.length} schemas)`);

function toPascalCase(s: string): string {
  const parts = s.split(/[-_/]/).filter(Boolean);
  let out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  if (/^\d/.test(out)) out = "_" + out;
  return out;
}

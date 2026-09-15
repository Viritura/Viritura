#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone";
import addFormats from "ajv-formats";

interface JsonSchema {
  $id: string;
}

const extensionDefinitions = [
  "root-extensions",
  "measure-global-extensions",
  "time-extensions",
  "key-extensions",
  "tempo-extensions",
  "part-extensions",
  "kit-component-extensions",
  "part-measure-extensions",
  "tuplet-extensions",
  "positioned-staff-config-extensions",
  "dynamic-group-extensions",
  "event-extensions",
  "event-markings-extensions",
  "note-extensions",
  "slur-extensions",
  "system-layout-extensions",
  "layout-staff-extensions",
  "score-extensions",
] as const;

const here = import.meta.dirname;
const mnxSchema = JSON.parse(readFileSync(resolve(here, "../schemas/mnx-schema.json"), "utf8")) as JsonSchema;
const extensionsSchema = JSON.parse(
  readFileSync(resolve(here, "../schemas/viritura-extensions.json"), "utf8"),
) as JsonSchema;
const outputPath = resolve(here, "../src/mnx/standaloneValidators.ts");

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  code: { esm: true, source: true },
});
addFormats(ajv);
ajv.addSchema(mnxSchema);
ajv.addSchema(extensionsSchema);

const schemaRefs: Record<string, string> = { mnxDocument: mnxSchema.$id };
for (const definition of extensionDefinitions) {
  const exportName = definition.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  schemaRefs[exportName] = `${extensionsSchema.$id}#/$defs/${definition}`;
}

const generated = standaloneCode(ajv, schemaRefs);
// AJV's CommonJS helper is either unwrapped by the bundler or exposed as
// { default: fn } by native ESM interop. Preserve the callable in both cases.
const esmGenerated = generated.replace(
  /const (\w+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/,
  'import $1Module from "ajv/dist/runtime/ucs2length.js";' +
    'const $1 = typeof $1Module === "function" ? $1Module : $1Module.default;',
);
if (esmGenerated === generated || esmGenerated.includes("require(")) {
  throw new Error("AJV standalone output no longer contains the expected Unicode-length helper.");
}

const banner = [
  "/* eslint-disable -- auto-generated standalone schema validators */",
  "// @ts-nocheck",
  "// AUTO-GENERATED FROM packages/format/schemas/*.json — DO NOT EDIT BY HAND.",
  "// Regenerate with: pnpm --filter @viritura/format gen:validators",
  "",
].join("\n");
writeFileSync(outputPath, banner + esmGenerated);
console.log(`Wrote ${outputPath}`);

#!/usr/bin/env node
/** Verify code-generated wire types without assuming the Git working tree is clean. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const mode = process.argv[2];
const here = import.meta.dirname;
const checks =
  mode === "mnx"
    ? {
        generator: "./generate-raw-types.ts",
        outputs: ["../../core/src/raw/raw.ts", "../../core/src/raw/mnx-schema.json"],
      }
    : mode === "viritura"
      ? {
          generator: "./generate-viritura-types.ts",
          outputs: ["../../core/src/raw/raw-viritura.ts"],
        }
      : null;

if (!checks) throw new Error("Expected generated-type target 'mnx' or 'viritura'.");

const outputPaths = checks.outputs.map((path) => resolve(here, path));
const before = await Promise.all(outputPaths.map((path) => readFile(path)));
await import(checks.generator);
const after = await Promise.all(outputPaths.map((path) => readFile(path)));
const changed = outputPaths.filter((_, index) => !before[index]!.equals(after[index]!));

if (changed.length > 0) {
  throw new Error(`Generated artifacts were stale: ${changed.join(", ")}. Commit the regenerated output.`);
}

console.log(`Generated ${mode} artifacts are current.`);

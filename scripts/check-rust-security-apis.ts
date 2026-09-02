#!/usr/bin/env node
/**
 * Rejects Rust API calls that are temporarily forbidden by security policy.
 *
 * This source-level check does not resolve dependencies, so it can run in the
 * engine-only CI job without installing the Linux desktop GTK stack.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rustRoots = ["engine", "apps/desktop/src-tauri/src", "tools"].map((path) => join(repoRoot, path));
const ignoredDirectories = new Set(["target"]);

interface ForbiddenApi {
  token: string;
  reason: string;
}

const forbiddenApis: readonly ForbiddenApi[] = [
  {
    token: "array_iter_str",
    reason:
      "glib::Variant::array_iter_str constructs the unsound VariantStrIter in glib < 0.20 " +
      "(RUSTSEC-2024-0429). See https://rustsec.org/advisories/RUSTSEC-2024-0429.html " +
      "and https://github.com/Viritura/Viritura/issues/3.",
  },
];

const violations: string[] = [];

function repoPath(path: string): string {
  return relative(repoRoot, path).split(sep).join("/");
}

function scan(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scan(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".rs")) continue;

    const source = readFileSync(path, "utf8");
    for (const api of forbiddenApis) {
      if (source.includes(api.token)) {
        violations.push(`${repoPath(path)}: ${api.reason}`);
      }
    }
  }
}

for (const root of rustRoots) scan(root);

if (violations.length > 0) {
  console.error("\nRust security API check failed:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

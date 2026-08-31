#!/usr/bin/env node
/**
 * Bans grab-bag filenames (utils.ts, helpers.ts, shared.ts, internal.ts,
 * misc.ts and their .tsx variants) and bans `utils/` folders inside any
 * `packages/*` source tree.
 *
 * Rationale (AGENTS.md → Module Structure rule 3): "Name internal files by
 * sub-concept, never by kind." Grab-bag names attract unrelated code over
 * time. Sub-concept names (e.g. `octaveLogic.ts`, `scoreClone.ts`,
 * `defaultSystemStarts.ts`) stay focused.
 *
 * Invoked from the top-level `pnpm lint` script.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packagesRoot = join(repoRoot, "packages");

const BANNED_FILENAMES: ReadonlySet<string> = new Set([
  "utils.ts",
  "utils.tsx",
  "helpers.ts",
  "helpers.tsx",
  "shared.ts",
  "shared.tsx",
  "internal.ts",
  "internal.tsx",
  "misc.ts",
  "misc.tsx",
]);

const BANNED_FOLDER_NAMES: ReadonlySet<string> = new Set(["utils", "helpers", "shared", "misc"]);

const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
  "storybook-static",
  "storybook-mnx-static",
]);

const violations: string[] = [];

function walk(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (IGNORED_DIRS.has(name)) continue;
      if (BANNED_FOLDER_NAMES.has(name)) {
        violations.push(`grab-bag folder: ${relative(repoRoot, abs).split(sep).join("/")}/`);
      }
      walk(abs);
    } else if (BANNED_FILENAMES.has(name)) {
      violations.push(`grab-bag filename: ${relative(repoRoot, abs).split(sep).join("/")}`);
    }
  }
}

walk(packagesRoot);

if (violations.length > 0) {
  console.error("\nGrab-bag filename/folder check failed:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nAGENTS.md rule 3: name internal files by sub-concept (e.g. octaveLogic.ts), not by kind (utils.ts, helpers.ts, shared.ts, internal.ts, misc.ts). Rename to a focused sub-concept name.\n",
  );
  process.exit(1);
}

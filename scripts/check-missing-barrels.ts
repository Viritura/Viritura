#!/usr/bin/env node
/**
 * Enforces AGENTS.md → Module Structure rule 1: "Every feature is a folder.
 * A folder may contain multiple files, but exposes exactly one public
 * surface: its `index.ts` barrel."
 *
 * Concretely: any folder under `packages/<lib>/src/` containing more than 2
 * authored source files (`.ts` / `.tsx`, excluding `*.stories.tsx` and
 * `*.test.ts(x)`) must contain an `index.ts` or `index.tsx`.
 *
 * Scope is limited to **library packages** — those with `src/index.ts`
 * or `src/index.tsx` at the package root. App packages (editor, website,
 * vscode-mnx-viewer) are excluded because the "external
 * consumers import only from the barrel" rationale doesn't apply to leaf
 * apps; folder-cohesion there is enforced by other lints (max-lines,
 * no-restricted-imports, grab-bag filename ban).
 *
 * The "> 2" threshold gives tiny single-concept folders breathing room
 * (e.g. a 2-file helper pair) while flagging anything that has grown
 * past the point where consumers would have to guess which file to
 * import.
 *
 * Invoked from the top-level `pnpm lint` script.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packagesRoot = join(repoRoot, "packages");

const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
  "storybook-static",
  "storybook-mnx-static",
  "__tests__",
  "__snapshots__",
]);

function isAuthoredSource(name: string): boolean {
  if (!/\.(ts|tsx)$/.test(name)) return false;
  if (/\.stories\.(ts|tsx)$/.test(name)) return false;
  if (/\.test\.(ts|tsx)$/.test(name)) return false;
  if (/\.d\.ts$/.test(name)) return false;
  return true;
}

const violations: string[] = [];

function walk(dir: string, depth: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const files: string[] = [];
  const dirs: string[] = [];
  for (const name of entries) {
    let st;
    try {
      st = statSync(join(dir, name));
    } catch {
      continue;
    }
    if (st.isFile()) files.push(name);
    else if (st.isDirectory()) dirs.push(name);
  }
  const sourceCount = files.filter(isAuthoredSource).length;
  const hasBarrel = files.includes("index.ts") || files.includes("index.tsx");
  // depth 0 is `packages/<pkg>/src` itself — always required to have a
  // barrel (the package entry), included in the check.
  if (sourceCount > 2 && !hasBarrel) {
    violations.push(`${relative(repoRoot, dir).split(sep).join("/")}/ — ${sourceCount} source files, no index.ts`);
  }
  for (const d of dirs) {
    if (IGNORED_DIRS.has(d)) continue;
    walk(join(dir, d), depth + 1);
  }
}

let pkgEntries: string[] = [];
try {
  pkgEntries = readdirSync(packagesRoot);
} catch {
  console.error(`Cannot read packages root: ${packagesRoot}`);
  process.exit(2);
}

for (const pkg of pkgEntries) {
  const src = join(packagesRoot, pkg, "src");
  if (!existsSync(src)) continue;
  // Library gate: only enforce on packages that themselves expose a
  // barrel at src/index.{ts,tsx}. App packages opt out by not having
  // one (they have no cross-package consumers).
  const isLibrary = existsSync(join(src, "index.ts")) || existsSync(join(src, "index.tsx"));
  if (!isLibrary) continue;
  walk(src, 0);
}

if (violations.length > 0) {
  console.error("\nMissing-barrel check failed:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nAGENTS.md Module Structure rule 1: every feature folder exposes exactly one public surface — its `index.ts` barrel. Add `index.ts` re-exporting the public API of the folder, or split the folder if there is no coherent public surface.\n",
  );
  process.exit(1);
}

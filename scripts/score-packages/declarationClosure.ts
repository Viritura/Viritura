/**
 * Public TypeScript declarations for the score packages.
 *
 * tsc emits declarations for the whole workspace graph; only the files
 * reachable from each package entry are copied. The public types are
 * self-contained, so an import of anything outside `allowed` means an
 * internal type has leaked into the public API.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";

export function emitDeclarations(root: string, tmp: string, entries: readonly string[]): string {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const outDir = resolve(tmp, "out");
  const tsconfig = resolve(tmp, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: resolve(root, "tsconfig.json"),
      compilerOptions: {
        rootDir: root,
        outDir,
        jsx: "react-jsx",
        declaration: true,
        declarationMap: false,
        emitDeclarationOnly: true,
        noEmit: false,
        skipLibCheck: true,
        composite: false,
        incremental: false,
      },
      files: entries.map((entry) => resolve(root, entry)),
    }),
  );
  const tsc = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", tsconfig], {
    cwd: root,
    stdio: "inherit",
  });
  if (tsc.status !== 0) throw new Error("Declaration emit failed");
  return outDir;
}

export interface DeclarationClosure {
  /** Directory holding the package's emitted `index.d.ts`. */
  readonly from: string;
  readonly to: string;
  /** Bare module specifiers the public types may import. */
  readonly allowed: readonly string[];
  /** Rewrite a bare specifier in the copied text, e.g. to a sibling directory in the archive. */
  readonly rewrite?: Readonly<Record<string, string>>;
}

export function copyDeclarationClosure({ from, to, allowed, rewrite = {} }: DeclarationClosure): void {
  const isAllowed = (spec: string): boolean => allowed.some((name) => spec === name || spec.startsWith(`${name}/`));
  const pending = ["index.d.ts"];
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let text = readFileSync(resolve(from, file), "utf8");
    const code = text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
    for (const match of code.matchAll(/from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
      const spec = match[1] ?? match[2]!;
      if (spec.startsWith(".")) {
        pending.push(posix.normalize(posix.join(posix.dirname(file), spec.replace(/\.js$/, "") + ".d.ts")));
      } else if (!isAllowed(spec)) {
        throw new Error(`${from}/${file} leaks non-public import "${spec}"`);
      }
    }
    for (const [spec, target] of Object.entries(rewrite)) {
      text = text.replaceAll(new RegExp(`(["'])${spec.replaceAll("/", "\\/")}\\1`, "g"), JSON.stringify(target));
    }
    const dest = resolve(to, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
}

#!/usr/bin/env node
/**
 * Build the standalone score-engine distribution (issue #241).
 *
 * Output: dist/score-engine/
 *   score-engine.js          ESM bundle, workspace dependencies inlined
 *   score-engine.worker.js   layout worker (module worker)
 *   score-viewer.js          framework-free viewer; imports ./score-engine.js
 *   score-engine.d.ts, score-viewer.d.ts, types/
 *   wasm/                    viritura_wasm.js + viritura_wasm_bg.wasm
 *   fonts/                   Bravura + Libertinus Serif
 *   examples/, LICENSE, THIRD_PARTY_NOTICES.md, LICENSES/
 *   manifest.json            versions, commit, per-file size + SHA-256
 *
 * Requires a prior `pnpm wasm:build`.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist/score-engine");
const typesTmp = resolve(root, "node_modules/.cache/score-engine-dts");
const wasmDir = resolve(root, "engine/viritura-wasm/pkg-browser");

const FONTS = [
  "Bravura.otf",
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-Italic.otf",
  "LibertinusSerif-BoldItalic.otf",
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function gitCommit(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

function cargoVersion(): string {
  const toml = readFileSync(resolve(root, "engine/viritura-engine/Cargo.toml"), "utf8");
  return /^version\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "unknown";
}

function copy(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/** Resolve the viewer's engine import to the sibling bundle so both share one engine instance. */
const engineAsSibling: Plugin = {
  name: "score-engine-sibling",
  setup(b) {
    b.onResolve({ filter: /^@viritura\/score-engine$/ }, () => ({ path: "./score-engine.js", external: true }));
  },
};

async function bundle(commit: string | null): Promise<void> {
  const common = {
    bundle: true,
    format: "esm" as const,
    platform: "browser" as const,
    target: "es2022",
    minify: true,
    sourcemap: "linked" as const,
    legalComments: "eof" as const,
    logLevel: "warning" as const,
    define: {
      __SCORE_ENGINE_BUNDLE__: "true",
      __SCORE_ENGINE_COMMIT__: JSON.stringify(commit ?? ""),
      __VIRITURA_WASM_ASSET_HASH__: '""',
      "import.meta.env": "{}",
    },
  };
  await build({
    ...common,
    entryPoints: { "score-engine": resolve(root, "packages/score-engine/src/index.ts") },
    outdir: out,
  });
  await build({
    ...common,
    entryPoints: { "score-engine.worker": resolve(root, "packages/score-engine/src/layoutWorker.ts") },
    outdir: out,
  });
  await build({
    ...common,
    entryPoints: { "score-viewer": resolve(root, "packages/score-viewer/src/index.ts") },
    outdir: out,
    plugins: [engineAsSibling],
  });
}

/**
 * Emit declarations with tsc, then copy only the files reachable from each
 * package entry. The public types are self-contained, so any remaining
 * `@viritura/*` import (other than the viewer's engine import) is an error.
 */
function declarations(): void {
  rmSync(typesTmp, { recursive: true, force: true });
  const tsconfig = resolve(typesTmp, "tsconfig.json");
  mkdirSync(typesTmp, { recursive: true });
  writeFileSync(
    tsconfig,
    JSON.stringify({
      extends: resolve(root, "tsconfig.json"),
      compilerOptions: {
        rootDir: root,
        outDir: resolve(typesTmp, "out"),
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        skipLibCheck: true,
        composite: false,
        incremental: false,
      },
      files: [resolve(root, "packages/score-engine/src/index.ts"), resolve(root, "packages/score-viewer/src/index.ts")],
    }),
  );
  const tsc = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", tsconfig], {
    cwd: root,
    stdio: "inherit",
  });
  if (tsc.status !== 0) throw new Error("Declaration emit failed");

  copyDeclarationClosure("score-engine", new Set());
  copyDeclarationClosure("score-viewer", new Set(["@viritura/score-engine"]));
  writeFileSync(resolve(out, "score-engine.d.ts"), 'export * from "./types/score-engine/index.js";\n');
  writeFileSync(resolve(out, "score-viewer.d.ts"), 'export * from "./types/score-viewer/index.js";\n');
}

function copyDeclarationClosure(pkg: string, allowed: Set<string>): void {
  const srcRoot = resolve(typesTmp, "out/packages", pkg, "src");
  const pending = ["index.d.ts"];
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let text = readFileSync(resolve(srcRoot, file), "utf8");
    const code = text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
    for (const match of code.matchAll(/from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
      const spec = match[1] ?? match[2]!;
      if (spec.startsWith(".")) {
        pending.push(posix.normalize(posix.join(posix.dirname(file), spec.replace(/\.js$/, "") + ".d.ts")));
      } else if (!allowed.has(spec)) {
        throw new Error(`${pkg}/${file} leaks non-public import "${spec}"`);
      }
    }
    text = text.replaceAll(/(["'])@viritura\/score-engine\1/g, '"../score-engine/index.js"');
    copy(resolve(srcRoot, file), resolve(out, "types", pkg, file));
    writeFileSync(resolve(out, "types", pkg, file), text);
  }
}

function assets(): void {
  for (const name of ["viritura_wasm.js", "viritura_wasm_bg.wasm"]) {
    const from = resolve(wasmDir, name);
    if (!existsSync(from)) throw new Error(`Missing ${relative(root, from)}; run \`pnpm wasm:build\` first.`);
    copy(from, resolve(out, "wasm", name));
  }
  for (const name of FONTS) copy(resolve(root, "assets/fonts", name), resolve(out, "fonts", name));
  copy(resolve(root, "LICENSE"), resolve(out, "LICENSE"));
  copy(resolve(root, "THIRD_PARTY_NOTICES.md"), resolve(out, "THIRD_PARTY_NOTICES.md"));
  copy(resolve(root, "LICENSES/OFL-1.1.txt"), resolve(out, "LICENSES/OFL-1.1.txt"));
  copy(resolve(root, "packages/score-engine/DIST_README.md"), resolve(out, "README.md"));
  const examples = resolve(root, "packages/score-viewer/examples");
  if (existsSync(examples)) {
    for (const name of readdirSync(examples)) copy(join(examples, name), resolve(out, "examples", name));
    copy(resolve(root, "packages/format/fixtures/mnx/grand-staff.mnx"), resolve(out, "examples/score.mnx"));
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function manifest(commit: string | null): void {
  const files = listFiles(out)
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path: relative(out, path).replaceAll("\\", "/"),
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const engineVersion = readJson<{ version: string }>(resolve(root, "packages/score-engine/package.json")).version;
  const viewerVersion = readJson<{ version: string }>(resolve(root, "packages/score-viewer/package.json")).version;
  writeFileSync(
    resolve(out, "manifest.json"),
    JSON.stringify(
      {
        name: "@viritura/score-engine",
        version: engineVersion,
        scoreViewerVersion: viewerVersion,
        engineVersion: cargoVersion(),
        commit,
        builtAt: new Date().toISOString(),
        entry: { engine: "score-engine.js", viewer: "score-viewer.js", worker: "score-engine.worker.js" },
        files,
      },
      null,
      2,
    ) + "\n",
  );
}

async function main(): Promise<void> {
  const commit = gitCommit();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await bundle(commit);
  declarations();
  assets();
  manifest(commit);
  for (const f of ["score-engine.js", "score-engine.worker.js", "score-viewer.js", "wasm/viritura_wasm_bg.wasm"]) {
    console.log(`${f.padEnd(28)} ${(statSync(resolve(out, f)).size / 1024).toFixed(1)} KB`);
  }
  console.log(`score-engine distribution written to ${relative(root, out)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

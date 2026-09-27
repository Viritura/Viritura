#!/usr/bin/env node
/**
 * Build the standalone score-engine release archive (issue #241).
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
 * The npm packages are built by `build-npm-packages.ts` from the same pieces.
 * Requires a prior `pnpm wasm:build`.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { copyDeclarationClosure, emitDeclarations } from "./score-packages/declarationClosure";
import { copyEngineAssets, copyFile, copyLicenses } from "./score-packages/engineAssets";
import { packageVersions, readManifest } from "./score-packages/packageVersions";
import { scoreBundleOptions } from "./score-packages/scoreBundle";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist/score-engine");
const typesTmp = resolve(root, "node_modules/.cache/score-engine-dts");

function gitCommit(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

function cargoVersion(): string {
  const toml = readFileSync(resolve(root, "engine/viritura-engine/Cargo.toml"), "utf8");
  return /^version\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "unknown";
}

/** Resolve the viewer's engine import to the sibling bundle so both share one engine instance. */
const engineAsSibling: Plugin = {
  name: "score-engine-sibling",
  setup(b) {
    b.onResolve({ filter: /^@viritura\/score-engine$/ }, () => ({ path: "./score-engine.js", external: true }));
  },
};

async function bundle(commit: string | null): Promise<void> {
  const common = scoreBundleOptions({ commit, minify: true });
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

function declarations(): void {
  const emitted = emitDeclarations(root, typesTmp, [
    "packages/score-engine/src/index.ts",
    "packages/score-viewer/src/index.ts",
  ]);
  copyDeclarationClosure({
    from: resolve(emitted, "packages/score-engine/src"),
    to: resolve(out, "types/score-engine"),
    allowed: [],
  });
  copyDeclarationClosure({
    from: resolve(emitted, "packages/score-viewer/src"),
    to: resolve(out, "types/score-viewer"),
    allowed: ["@viritura/score-engine"],
    rewrite: { "@viritura/score-engine": "../score-engine/index.js" },
  });
  writeFileSync(resolve(out, "score-engine.d.ts"), 'export * from "./types/score-engine/index.js";\n');
  writeFileSync(resolve(out, "score-viewer.d.ts"), 'export * from "./types/score-viewer/index.js";\n');
}

function assets(): void {
  copyEngineAssets(root, out);
  copyLicenses(root, out);
  copyFile(resolve(root, "packages/score-engine/DIST_README.md"), resolve(out, "README.md"));
  const examples = resolve(root, "packages/score-viewer/examples");
  if (existsSync(examples)) {
    for (const name of readdirSync(examples)) copyFile(join(examples, name), resolve(out, "examples", name));
    copyFile(resolve(root, "packages/format/fixtures/mnx/grand-staff.mnx"), resolve(out, "examples/score.mnx"));
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
  writeFileSync(
    resolve(out, "manifest.json"),
    JSON.stringify(
      {
        name: "@viritura/score-engine",
        version: readManifest(root, "score-engine").version,
        scoreViewerVersion: readManifest(root, "score-viewer").version,
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
  packageVersions(root);
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

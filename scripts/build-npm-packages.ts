#!/usr/bin/env node
/**
 * Build the publishable `dist/` directories of the three score packages.
 *
 *   packages/score-engine/dist/        index.js, score-engine.worker.js, wasm/, fonts/
 *   packages/score-viewer/dist/        index.js (imports @viritura/score-engine)
 *   packages/score-viewer-react/dist/  index.js (imports react, both packages above)
 *
 * Each also gets `index.d.ts` + `types/` and the licences. Viritura's
 * internal workspace packages are inlined; only the dependencies and peers
 * a package declares stay as imports, so the published manifests are
 * complete. `publishConfig` points the packed manifests at these files.
 *
 * Requires a prior `pnpm wasm:build`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions, type Metafile } from "esbuild";
import { copyDeclarationClosure, emitDeclarations } from "./score-packages/declarationClosure";
import { copyEngineAssets, copyFile, copyLicenses } from "./score-packages/engineAssets";
import { readManifest, SCORE_PACKAGES, sharedVersion, type ScorePackage } from "./score-packages/packageVersions";
import { externalPackages, scoreBundleOptions } from "./score-packages/scoreBundle";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typesTmp = resolve(root, "node_modules/.cache/score-packages-dts");

/** Strings that must never reach a published bundle: they only resolve inside Viritura's Vite apps. */
const FORBIDDEN_OUTPUT = ["./layoutWorker.ts", "import.meta.env.", "@viritura/format", "@viritura/renderer"];

function gitCommit(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

function distOf(pkg: ScorePackage): string {
  return resolve(root, "packages", pkg, "dist");
}

/** Packages a package's published manifest lets it import. */
function declaredImports(pkg: ScorePackage): string[] {
  const manifest = readManifest(root, pkg);
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];
}

function checkOutput(pkg: ScorePackage, metafile: Metafile): void {
  const declared = declaredImports(pkg);
  for (const [file, output] of Object.entries(metafile.outputs)) {
    if (file.endsWith(".map")) continue;
    for (const imp of output.imports) {
      if (!imp.external || imp.path.startsWith(".")) continue;
      if (!declared.some((name) => imp.path === name || imp.path.startsWith(`${name}/`))) {
        throw new Error(`${file} imports undeclared package "${imp.path}"`);
      }
    }
    const text = readFileSync(resolve(root, file), "utf8");
    for (const needle of FORBIDDEN_OUTPUT) {
      if (text.includes(needle)) throw new Error(`${file} still references ${needle}`);
    }
  }
}

async function bundlePackage(
  pkg: ScorePackage,
  entries: Record<string, string>,
  commit: string | null,
  extra: BuildOptions = {},
): Promise<void> {
  const result = await build({
    ...scoreBundleOptions({ commit, minify: false }),
    ...extra,
    entryPoints: Object.fromEntries(Object.entries(entries).map(([name, src]) => [name, resolve(root, src)])),
    outdir: distOf(pkg),
    plugins: [externalPackages(declaredImports(pkg))],
  });
  checkOutput(pkg, result.metafile!);
}

async function bundles(commit: string | null): Promise<void> {
  await bundlePackage("score-engine", { index: "packages/score-engine/src/index.ts" }, commit);
  // Loaded by URL at runtime, so it must not import anything, declared or not.
  await bundlePackage("score-engine", { "score-engine.worker": "packages/score-engine/src/layoutWorker.ts" }, commit);
  await bundlePackage("score-viewer", { index: "packages/score-viewer/src/index.ts" }, commit);
  await bundlePackage("score-viewer-react", { index: "packages/score-viewer-react/src/index.ts" }, commit, {
    banner: { js: '"use client";' },
  });
}

function declarations(): void {
  const emitted = emitDeclarations(
    root,
    typesTmp,
    SCORE_PACKAGES.map((pkg) => `packages/${pkg}/src/index.ts`),
  );
  for (const pkg of SCORE_PACKAGES) {
    copyDeclarationClosure({
      from: resolve(emitted, "packages", pkg, "src"),
      to: resolve(distOf(pkg), "types"),
      allowed: declaredImports(pkg),
    });
    writeFileSync(resolve(distOf(pkg), "index.d.ts"), 'export * from "./types/index.js";\n');
  }
}

async function main(): Promise<void> {
  const version = sharedVersion(root);
  const commit = gitCommit();
  for (const pkg of SCORE_PACKAGES) rmSync(distOf(pkg), { recursive: true, force: true });
  await bundles(commit);
  declarations();
  copyEngineAssets(root, distOf("score-engine"));
  copyLicenses(root, distOf("score-engine"));
  // The viewers ship no fonts or third-party code, only Viritura's own MIT code.
  for (const pkg of ["score-viewer", "score-viewer-react"] as const) {
    copyFile(resolve(root, "LICENSE"), resolve(distOf(pkg), "LICENSE"));
  }
  for (const pkg of SCORE_PACKAGES) {
    const size = statSync(resolve(distOf(pkg), "index.js")).size / 1024;
    console.log(`@viritura/${pkg}@${version}`.padEnd(40), `index.js ${size.toFixed(1)} KB`);
  }
  console.log(`npm package builds written to ${relative(root, resolve(root, "packages"))}/*/dist`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

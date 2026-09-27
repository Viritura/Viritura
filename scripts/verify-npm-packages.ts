#!/usr/bin/env node
/**
 * Verify the score packages as npm will publish them.
 *
 *  1. `pnpm pack` each package (applies `publishConfig`, rewrites `workspace:`).
 *  2. Check each tarball: complete manifest, `dist/` entry points present,
 *     nothing from `src/`.
 *  3. Install the tarballs into a fresh npm project (`consumer-fixture/`) with
 *     registry React and Vite, then type-check it and `vite build` it.
 *  4. With `--render`, serve the build and load it in headless Chromium: the
 *     engine, its layout worker, the viewer and the React viewer must all
 *     render from the self-hosted assets.
 *
 * Run `pnpm build:npm-packages` first. Pass `--keep` to leave the temp
 * directory in place for inspection.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCORE_PACKAGES, sharedVersion, type ScorePackage } from "./score-packages/packageVersions";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "scripts/score-packages/consumer-fixture");
const args = new Set(process.argv.slice(2));

const REQUIRED_FILES: Record<ScorePackage, string[]> = {
  "score-engine": [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/score-engine.worker.js",
    "dist/wasm/viritura_wasm.js",
    "dist/wasm/viritura_wasm_bg.wasm",
    "dist/fonts/Bravura.otf",
    "dist/fonts/LibertinusSerif-Regular.otf",
    "dist/LICENSE",
    "dist/THIRD_PARTY_NOTICES.md",
    "dist/LICENSES/OFL-1.1.txt",
    "README.md",
  ],
  "score-viewer": ["dist/index.js", "dist/index.d.ts", "dist/LICENSE", "README.md"],
  "score-viewer-react": ["dist/index.js", "dist/index.d.ts", "dist/LICENSE", "README.md"],
};

/** Files the documented production recipe copies out of the engine package. */
const ENGINE_RUNTIME_FILES = ["wasm", "fonts", "score-engine.worker.js"];

/** `shell` only for package-manager shims (`pnpm.cmd`, `npm.cmd`) on Windows; node binaries run directly. */
function run(command: string, argv: readonly string[], cwd: string): string {
  const shim = process.platform === "win32" && (command === "pnpm" || command === "npm");
  const res = spawnSync(command, argv, { cwd, encoding: "utf8", shell: shim });
  if (res.status !== 0) {
    throw new Error(`${command} ${argv.join(" ")} failed in ${cwd}\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

interface PackedManifest {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
}

function pack(pkg: ScorePackage, dest: string): string {
  const before = new Set(existsSync(dest) ? readdirSync(dest) : []);
  run("pnpm", ["pack", "--pack-destination", dest], resolve(root, "packages", pkg));
  const created = readdirSync(dest).find((name) => name.endsWith(".tgz") && !before.has(name));
  if (!created) throw new Error(`pnpm pack produced no tarball for ${pkg}`);
  return resolve(dest, created);
}

function inspectTarball(pkg: ScorePackage, tarball: string, scratch: string, version: string): void {
  const dir = resolve(scratch, pkg);
  mkdirSync(dir, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", dir], root);
  const content = resolve(dir, "package");
  const text = readFileSync(resolve(content, "package.json"), "utf8");
  const manifest = JSON.parse(text) as PackedManifest;
  const problems: string[] = [];
  if (text.includes("workspace:")) problems.push("manifest still contains workspace: ranges");
  if (manifest.private) problems.push("manifest is private");
  if (manifest.version !== version) problems.push(`version ${manifest.version}, expected ${version}`);
  if (manifest.main !== "./dist/index.js") problems.push(`main is ${manifest.main}`);
  if (manifest.types !== "./dist/index.d.ts") problems.push(`types is ${manifest.types}`);
  if (JSON.stringify(manifest.exports ?? {}).includes("./src/")) problems.push("exports point into src/");
  const files = new Set(listFiles(content));
  for (const required of REQUIRED_FILES[pkg]) if (!files.has(required)) problems.push(`missing ${required}`);
  for (const file of files) if (file.startsWith("src/")) problems.push(`ships source file ${file}`);
  if (problems.length) throw new Error(`${manifest.name}:\n  ${problems.join("\n  ")}`);
  console.log(`✓ ${manifest.name}@${manifest.version} tarball (${files.size} files)`);
}

/** Version the workspace itself tests with, so the consumer check tracks upgrades. */
function installedVersion(name: string): string {
  const require = createRequire(resolve(root, "apps/editor/package.json"));
  return (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as { version: string }).version;
}

function writeConsumer(app: string, tarballs: Record<ScorePackage, string>): void {
  cpSync(fixture, app, { recursive: true });
  const deps = Object.fromEntries(SCORE_PACKAGES.map((pkg) => [`@viritura/${pkg}`, `file:${tarballs[pkg]}`]));
  writeFileSync(
    resolve(app, "package.json"),
    JSON.stringify(
      {
        name: "score-packages-consumer",
        private: true,
        type: "module",
        dependencies: { ...deps, react: "^19.2.0", "react-dom": "^19.2.0" },
        devDependencies: {
          "@types/react": "^19.2.0",
          "@types/react-dom": "^19.2.0",
          typescript: installedVersion("typescript"),
          vite: installedVersion("vite"),
        },
        // Resolve the viewers' own dependency on the engine to the local tarball, not the registry.
        overrides: Object.fromEntries(Object.keys(deps).map((name) => [name, `$${name}`])),
      },
      null,
      2,
    ),
  );
}

function stageEngineAssets(app: string): void {
  const engineDist = resolve(app, "node_modules/@viritura/score-engine/dist");
  const publicDir = resolve(app, "public");
  for (const name of ENGINE_RUNTIME_FILES) {
    cpSync(resolve(engineDist, name), resolve(publicDir, "score-engine", name), { recursive: true });
  }
  cpSync(resolve(root, "packages/format/fixtures/mnx/grand-staff.mnx"), resolve(publicDir, "score.mnx"));
}

function viteBin(app: string): string {
  return resolve(app, "node_modules/vite/bin/vite.js");
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`vite preview exited with ${server.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite preview did not start at ${url}`);
}

async function renderCheck(app: string): Promise<void> {
  const port = 4179;
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(
    process.execPath,
    [viteBin(app), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: app, stdio: "ignore" },
  );
  try {
    await waitForServer(url, server);
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") pageErrors.push(msg.text());
      });
      await page.goto(url);
      await page.waitForFunction(() => window.__scorePackages?.done === true, undefined, { timeout: 60_000 });
      const results = await page.evaluate(() => window.__scorePackages);
      const failures = (["engine", "worker", "viewer", "react"] as const).filter(
        (check) => !results[check]?.startsWith("ok"),
      );
      for (const check of ["engine", "worker", "viewer", "react"] as const) {
        console.log(`${failures.includes(check) ? "✗" : "✓"} ${check}: ${results[check] ?? "no result"}`);
      }
      if (failures.length || pageErrors.length) {
        throw new Error(
          `Render check failed.${pageErrors.length ? `\nPage errors:\n  ${pageErrors.join("\n  ")}` : ""}`,
        );
      }
    } finally {
      await browser.close();
    }
  } finally {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}

async function main(): Promise<void> {
  const version = sharedVersion(root);
  for (const pkg of SCORE_PACKAGES) {
    if (!existsSync(resolve(root, "packages", pkg, "dist/index.js"))) {
      throw new Error(`packages/${pkg}/dist is missing; run \`pnpm build:npm-packages\` first.`);
    }
  }
  const work = mkdtempSync(join(tmpdir(), "viritura-npm-"));
  try {
    const tarballDir = resolve(work, "tarballs");
    mkdirSync(tarballDir);
    const tarballs = {} as Record<ScorePackage, string>;
    for (const pkg of SCORE_PACKAGES) {
      tarballs[pkg] = pack(pkg, tarballDir);
      inspectTarball(pkg, tarballs[pkg], resolve(work, "inspect"), version);
    }

    const app = resolve(work, "consumer");
    writeConsumer(app, tarballs);
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);
    console.log("✓ installed into a fresh npm project");
    run(process.execPath, [resolve(app, "node_modules/typescript/bin/tsc"), "-p", "."], app);
    console.log("✓ consumer type-checks against the published declarations");
    stageEngineAssets(app);
    run(process.execPath, [viteBin(app), "build", "--logLevel", "warn"], app);
    console.log("✓ consumer builds with Vite");
    if (args.has("--render")) await renderCheck(app);
  } finally {
    if (args.has("--keep")) console.log(`Kept ${work}`);
    else rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

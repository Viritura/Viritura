#!/usr/bin/env node
/**
 * Verify the score packages as npm will publish them.
 *
 *  1. `pnpm pack` each package (applies `publishConfig`, rewrites `workspace:`).
 *  2. Check each tarball: complete manifest, `dist/` entry points present,
 *     nothing from `src/`.
 *  3. Install the tarballs into a fresh npm project (`consumer-fixture/`) and
 *     verify the installed WASM renders native v46 features.
 *  4. Type-check the consumer with registry React and Vite, then build it.
 *  5. With `--render`, serve the build and load it in headless Chromium: the
 *     engine, its layout worker, the viewer and the React viewer must all
 *     render from the self-hosted assets.
 *
 * Run `pnpm build:npm-packages` first. Pass `--keep` to leave the temp
 * directory in place for inspection. Pass `--plan <file>` (from
 * `pnpm score-release plan --out`) to install the plan's unreleased
 * dependencies from npm instead of packing them, so a viewer release is
 * checked against the engine its users will actually get.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersions, SCORE_PACKAGES, type ScorePackage } from "./score-packages/packageVersions";
import type { ReleasePlan } from "./score-packages/releasePlan";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "scripts/score-packages/consumer-fixture");
const argv = process.argv.slice(2);
const args = new Set(argv);

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
  dependencies?: Record<string, string>;
}

function pack(pkg: ScorePackage, dest: string): string {
  const before = new Set(existsSync(dest) ? readdirSync(dest) : []);
  run("pnpm", ["pack", "--pack-destination", dest], resolve(root, "packages", pkg));
  const created = readdirSync(dest).find((name) => name.endsWith(".tgz") && !before.has(name));
  if (!created) throw new Error(`pnpm pack produced no tarball for ${pkg}`);
  return resolve(dest, created);
}

function inspectTarball(
  pkg: ScorePackage,
  tarball: string,
  scratch: string,
  versions: Record<ScorePackage, string>,
): void {
  const dir = resolve(scratch, pkg);
  mkdirSync(dir, { recursive: true });
  run("tar", ["-xzf", tarball, "-C", dir], root);
  const content = resolve(dir, "package");
  const text = readFileSync(resolve(content, "package.json"), "utf8");
  const manifest = JSON.parse(text) as PackedManifest;
  const problems: string[] = [];
  if (text.includes("workspace:")) problems.push("manifest still contains workspace: ranges");
  if (manifest.private) problems.push("manifest is private");
  if (manifest.version !== versions[pkg]) problems.push(`version ${manifest.version}, expected ${versions[pkg]}`);
  // Sibling score packages must pack to a caret range on the version tested here.
  for (const sibling of SCORE_PACKAGES) {
    const range = manifest.dependencies?.[`@viritura/${sibling}`];
    if (range !== undefined && range !== `^${versions[sibling]}`) {
      problems.push(`depends on @viritura/${sibling}@${range}, expected ^${versions[sibling]}`);
    }
  }
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

/** `specs` maps each package to a local tarball (`file:`) or a published version. */
function writeConsumer(app: string, specs: Record<ScorePackage, string>): void {
  cpSync(fixture, app, { recursive: true });
  const deps = Object.fromEntries(SCORE_PACKAGES.map((pkg) => [`@viritura/${pkg}`, specs[pkg]]));
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
        // Resolve the viewers' own dependency on the engine to the same copy the app uses.
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
  cpSync(resolve(root, "packages/format/fixtures/mnx-v46/feature-integration.mnx"), resolve(publicDir, "mnx46.mnx"));
}

interface NativeWasmModule {
  initSync(input: { module: Uint8Array }): unknown;
  compute_full_score_layout(json: string, spatium: number, pageWidth: number): string;
}

function isNativeWasmModule(value: unknown): value is NativeWasmModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "initSync" in value &&
    typeof value.initSync === "function" &&
    "compute_full_score_layout" in value &&
    typeof value.compute_full_score_layout === "function"
  );
}

interface NativeDisplayList {
  commands: Record<string, unknown>[];
  element_ids: (string | null)[];
}

function isNativeDisplayList(value: unknown): value is NativeDisplayList {
  return (
    typeof value === "object" &&
    value !== null &&
    "commands" in value &&
    Array.isArray(value.commands) &&
    value.commands.every((command: unknown) => typeof command === "object" && command !== null) &&
    "element_ids" in value &&
    Array.isArray(value.element_ids) &&
    value.element_ids.every((id: unknown) => id === null || typeof id === "string") &&
    value.commands.length === value.element_ids.length
  );
}

async function verifyNativeMnx46Assets(app: string): Promise<void> {
  const wasmDir = resolve(app, "node_modules/@viritura/score-engine/dist/wasm");
  const module: unknown = await import(pathToFileURL(resolve(wasmDir, "viritura_wasm.js")).href);
  if (!isNativeWasmModule(module)) throw new Error("Packed engine does not expose the native layout API");
  module.initSync({ module: readFileSync(resolve(wasmDir, "viritura_wasm_bg.wasm")) });
  const json = readFileSync(resolve(app, "public/mnx46.mnx"), "utf8");
  const display: unknown = JSON.parse(module.compute_full_score_layout(json, 10, 1200));
  if (!isNativeDisplayList(display)) throw new Error("Packed engine returned an invalid native display list");
  const tagged = (type: string, tag: string) =>
    display.commands.some(
      (command, index) =>
        command.type === type &&
        display.element_ids[index]?.includes(tag) &&
        (type !== "DrawLine" ||
          (typeof command.x1 === "number" &&
            typeof command.x2 === "number" &&
            Number.isFinite(command.x1) &&
            Number.isFinite(command.x2) &&
            command.x2 > command.x1)),
    );
  const glyph = (codepoint: number, tag?: string) =>
    display.commands.some(
      (command, index) =>
        command.type === "DrawGlyph" &&
        (command.codepoint === codepoint || command.codepoint === String.fromCodePoint(codepoint)) &&
        typeof command.x === "number" &&
        typeof command.y === "number" &&
        Number.isFinite(command.x) &&
        Number.isFinite(command.y) &&
        (tag === undefined || display.element_ids[index]?.includes(tag)),
    );
  if (!tagged("DrawLine", "/lyric-")) throw new Error("Packed engine loses native lyric extenders");
  if (!display.element_ids.some((id) => id?.startsWith("m0/caesura"))) {
    throw new Error("Packed engine loses global caesuras");
  }
  for (const codepoint of [0xe5d0, 0xe5e0, 0xe5d7, 0xe5d4, 0xe04a, 0xe049]) {
    if (!glyph(codepoint)) throw new Error(`Packed engine loses v46 glyph U+${codepoint.toString(16)}`);
  }
  for (const variant of ["immediate", "gradual", "relative", "accent"]) {
    if (!glyph(0xe520, `integration-${variant}`)) {
      throw new Error(`Packed engine loses explicit ${variant} dynamic appearance`);
    }
  }
  console.log("✓ packed native WASM renders every v46 feature in the integration fixture");
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
      const failures = (["engine", "worker", "viewer", "react", "mnx46"] as const).filter(
        (check) => !results[check]?.startsWith("ok"),
      );
      for (const check of ["engine", "worker", "viewer", "react", "mnx46"] as const) {
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
  const versions = packageVersions(root);
  const planFile = argv[argv.indexOf("--plan") + 1];
  const plan = args.has("--plan") && planFile ? (JSON.parse(readFileSync(planFile, "utf8")) as ReleasePlan) : null;
  const fromNpm = new Map((plan?.registry ?? []).map((r) => [r.pkg, r.version]));
  for (const pkg of SCORE_PACKAGES) {
    if (!existsSync(resolve(root, "packages", pkg, "dist/index.js"))) {
      throw new Error(`packages/${pkg}/dist is missing; run \`pnpm build:npm-packages\` first.`);
    }
  }
  const work = mkdtempSync(join(tmpdir(), "viritura-npm-"));
  try {
    const tarballDir = resolve(work, "tarballs");
    mkdirSync(tarballDir);
    const specs = {} as Record<ScorePackage, string>;
    for (const pkg of SCORE_PACKAGES) {
      const published = fromNpm.get(pkg);
      if (published) {
        specs[pkg] = published;
        console.log(`✓ @viritura/${pkg}@${published} from npm`);
        continue;
      }
      const tarball = pack(pkg, tarballDir);
      inspectTarball(pkg, tarball, resolve(work, "inspect"), versions);
      specs[pkg] = `file:${tarball}`;
    }

    const app = resolve(work, "consumer");
    writeConsumer(app, specs);
    run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);
    console.log("✓ installed into a fresh npm project");
    run(process.execPath, [resolve(app, "node_modules/typescript/bin/tsc"), "-p", "."], app);
    console.log("✓ consumer type-checks against the published declarations");
    stageEngineAssets(app);
    await verifyNativeMnx46Assets(app);
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

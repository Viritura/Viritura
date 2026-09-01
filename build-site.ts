#!/usr/bin/env node

/**
 * build-site.ts — Assembles all sub-builds into a single deployable dist/ folder.
 *
 * Output structure:
 *   dist/
 *     index.html            ← landing page
 *     assets/               ← landing page assets
 *     app/                  ← editor (Vite build)
 *     docs/                 ← prerendered documentation pages
 *     mnx/                  ← prerendered MNX hub + tooling
 *       mxl-converter/      ← MusicXML→MNX converter
 *       examples/           ← MNX-only storybook (public)
 */

import { execSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = resolve(root, "dist");
const wasmCacheFile = resolve(root, "engine/viritura-wasm/pkg-browser/.build-cache.json");

function run(cmd: string, cwd: string = root): void {
  console.log(`\n▸ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env } });
}

function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) {
    console.error(`  ✗ Source not found: ${src}`);
    process.exit(1);
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`  ✓ ${src} → ${dest}`);
}

// ── Clean ──
console.log("═══ Viritura Site Build ═══\n");
if (!process.argv.includes("--skip-wasm")) {
  run("pnpm build:wasm");
}

process.env.VIRITURA_SITE = "true";
if (existsSync(wasmCacheFile)) {
  const cache = JSON.parse(readFileSync(wasmCacheFile, "utf8")) as { inputHash?: string };
  process.env.VIRITURA_WASM_BUILD_HASH = cache.inputHash ?? "unknown";
}

if (existsSync(dist)) {
  rmSync(dist, { recursive: true });
}
mkdirSync(dist, { recursive: true });

// ── 1–2. Website + editor (Turbo restores unchanged package outputs) ──
console.log("\n── 1–2/3 Website + Editor App ──");
run("pnpm turbo run build --filter=@viritura/website --filter=@viritura/editor");
copyDir(resolve(root, "apps/website/dist"), dist);

// Editor app is built with `VIRITURA_SITE=true` from this process environment.
copyDir(resolve(root, "apps/editor/dist"), resolve(dist, "app"));

// ── 3. MNX Storybook (public, base: /mnx/examples/) ──
console.log("\n── 3/3 MNX Storybook ──");
run("pnpm turbo run build-storybook:mnx --filter=@viritura/editor");
copyDir(resolve(root, "apps/editor/storybook-mnx-static"), resolve(dist, "mnx/examples"));
copyFileSync(resolve(dist, "mnx/examples/iframe.html"), resolve(dist, "mnx/iframe.html"));
copyFileSync(resolve(dist, "mnx/examples/index.json"), resolve(dist, "mnx/index.json"));

if (process.env.VIRITURA_EXTERNAL_SOUNDFONT === "true") {
  rmSync(resolve(dist, "mnx/examples/sounds/Shan-SGM-Pro-15.sf2"), { force: true });
}

console.log("\n═══ Site build complete ═══");
console.log(`Output: ${dist}`);
console.log(`
  /               → Landing page
  app.viritura.com → Editor (served from dist/app)
  /mnx            → MNX hub
  /mnx/playground → MNX playground
  /mnx/mxl-converter → MusicXML→MNX converter
  /mnx/examples   → MNX Storybook (public)
`);

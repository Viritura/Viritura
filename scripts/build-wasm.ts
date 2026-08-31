#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = resolve(root, "engine");
const wasmCrate = resolve(engine, "viritura-wasm");
const output = resolve(wasmCrate, "pkg-browser");
const editorStaging = resolve(root, "apps/editor/public/wasm");
const cacheFile = resolve(output, ".build-cache.json");
const force = process.argv.includes("--force");
const development = process.argv.includes("--dev");
const developmentOptLevel = process.env.CARGO_PROFILE_DEV_OPT_LEVEL ?? "0";

const inputRoots = [
  "engine/.cargo",
  "engine/Cargo.lock",
  "engine/Cargo.toml",
  "engine/clippy.toml",
  "engine/rust-toolchain.toml",
  "engine/rustfmt.toml",
  "engine/viritura-engine/Cargo.toml",
  "engine/viritura-engine/src",
  "engine/viritura-wasm/Cargo.toml",
  "engine/viritura-wasm/src",
];

const expectedOutputs = [
  "package.json",
  "viritura_wasm.js",
  "viritura_wasm.d.ts",
  "viritura_wasm_bg.wasm",
  "viritura_wasm_bg.wasm.d.ts",
];

function stageEditorAssets(): void {
  rmSync(editorStaging, { recursive: true, force: true });
  mkdirSync(editorStaging, { recursive: true });
  for (const file of expectedOutputs) {
    copyFileSync(resolve(output, file), resolve(editorStaging, file));
  }
}

function collectDirectory(absolute: string): string[] {
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = resolve(absolute, entry.name);
    return entry.isDirectory() ? collectDirectory(child) : [child];
  });
}

function collectInput(path: string): string[] {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return [];
  return statSync(absolute).isDirectory() ? collectDirectory(absolute) : [absolute];
}

function toolVersion(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return result.stdout.trim();
}

const files = inputRoots.flatMap(collectInput).sort((left, right) => left.localeCompare(right));

const hash = createHash("sha256");
hash.update(development ? "wasm-build:dev" : "wasm-build:release");
if (development) hash.update(`opt-level:${developmentOptLevel}`);
hash.update(toolVersion("rustc", ["-Vv"]));
hash.update(toolVersion("wasm-pack", ["--version"]));
for (const file of files) {
  hash.update(relative(root, file).replaceAll("\\", "/"));
  hash.update(readFileSync(file));
}
const inputHash = hash.digest("hex");

let cachedHash: string | undefined;
if (existsSync(cacheFile)) {
  try {
    cachedHash = (JSON.parse(readFileSync(cacheFile, "utf8")) as { inputHash?: string }).inputHash;
  } catch {
    cachedHash = undefined;
  }
}

const outputsExist = expectedOutputs.every((file) => existsSync(resolve(output, file)));
if (!force && cachedHash === inputHash && outputsExist) {
  stageEditorAssets();
  console.log(`WASM cache hit (${inputHash.slice(0, 12)}); skipping wasm-pack.`);
  process.exit(0);
}

console.log(
  force
    ? `Forcing ${development ? "development" : "optimized"} WASM rebuild.`
    : `WASM cache miss (${inputHash.slice(0, 12)}); rebuilding ${development ? "development" : "optimized"} WASM.`,
);
const buildArgs = ["build", "--target", "web", "--out-dir", "pkg-browser"];
if (development) buildArgs.push("--dev");
const build = spawnSync("wasm-pack", buildArgs, {
  cwd: wasmCrate,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

writeFileSync(cacheFile, `${JSON.stringify({ inputHash }, null, 2)}\n`);
stageEditorAssets();
console.log(`WASM cache updated (${inputHash.slice(0, 12)}).`);

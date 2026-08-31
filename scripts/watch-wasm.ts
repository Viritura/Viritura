#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const pollIntervalMs = 1000;
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

function collectFiles(path: string): string[] {
  const absolute = resolve(root, path);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return [];
  }

  if (!stats.isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => collectFiles(resolve(path, entry.name)));
}

function inputSignature(): string {
  return inputRoots
    .flatMap(collectFiles)
    .sort()
    .map((file) => {
      try {
        const stats = statSync(file);
        return `${file}:${stats.size}:${stats.mtimeMs}`;
      } catch {
        return `${file}:missing`;
      }
    })
    .join("|");
}

function buildWasm(): Promise<void> {
  return new Promise((resolveBuild, rejectBuild) => {
    const build = spawn("node", ["--experimental-strip-types", "scripts/build-wasm.ts", "--dev"], {
      cwd: root,
      stdio: "inherit",
    });

    build.once("error", rejectBuild);
    build.once("exit", (code, signal) => {
      if (code === 0) {
        resolveBuild();
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      rejectBuild(new Error(`WASM build exited with ${reason}.`));
    });
  });
}

let building = false;
let pendingBuild = false;
let lastSignature = "";

async function rebuildIfNeeded(): Promise<void> {
  const signature = inputSignature();
  if (signature === lastSignature) return;
  lastSignature = signature;

  if (building) {
    pendingBuild = true;
    return;
  }

  building = true;
  try {
    await buildWasm();
  } finally {
    building = false;
    if (pendingBuild) {
      pendingBuild = false;
      await rebuildIfNeeded();
    }
  }
}

await rebuildIfNeeded();
console.log(`[viritura-wasm] watching Rust inputs every ${pollIntervalMs}ms.`);
setInterval(() => {
  void rebuildIfNeeded().catch((error: unknown) => {
    console.error("[viritura-wasm] rebuild failed:", error);
  });
}, pollIntervalMs);

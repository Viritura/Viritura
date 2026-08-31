#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = resolve(root, "engine");
const lockDirectory = resolve(engine, "target");
const lockFile = resolve(lockDirectory, ".viritura-test.lock");

mkdirSync(lockDirectory, { recursive: true });

function processIsRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): number {
  try {
    const descriptor = openSync(lockFile, "wx");
    writeFileSync(descriptor, `${process.pid}\n`);
    return descriptor;
  } catch (error) {
    if (!existsSync(lockFile)) throw error;
    const owner = Number.parseInt(readFileSync(lockFile, "utf8").trim(), 10);
    if (Number.isFinite(owner) && processIsRunning(owner)) {
      throw new Error(`Rust test suite is already running in process ${owner}.`);
    }
    unlinkSync(lockFile);
    const descriptor = openSync(lockFile, "wx");
    writeFileSync(descriptor, `${process.pid}\n`);
    return descriptor;
  }
}

const descriptor = acquireLock();
try {
  const result = spawnSync("cargo", ["test", "-p", "viritura-engine", "--lib", ...process.argv.slice(2)], {
    cwd: engine,
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally {
  closeSync(descriptor);
  unlinkSync(lockFile);
}

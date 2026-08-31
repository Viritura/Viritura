#!/usr/bin/env node

/**
 * deploy.ts — Build the static site and ship it to schemes.me.
 *
 * Pipeline:
 *   1. pnpm build:site   (builds WASM and assembles dist/ via build-site.ts)
 *   2. tar | ssh "untar into staging dir, then atomic swap"
 *
 * The atomic-swap step (mv old → old.prev, mv new → live, rm -rf old.prev)
 * minimises the window where the site could 404 mid-deploy.
 *
 * Why tar-over-ssh instead of rsync? It's portable: Windows ships both
 * bsdtar and OpenSSH out of the box since 10/1809, so no WSL or Cygwin
 * needed. Trade-off: no incremental delta, but the whole site is a few MB
 * gzipped — fine for a manual deploy cadence.
 *
 * Requires:
 *   - SSH key auth to peter@schemes.me (no password prompt)
 *   - `tar` and `ssh` on PATH (default on Windows 10+, macOS, Linux)
 *
 * Flags:
 *   --skip-wasm   Skip the Rust→WASM build (use last artifacts on disk)
 *   --skip-build  Skip the JS site build (re-deploy the existing dist/)
 *
 * Override the target via env:
 *   VIRITURA_DEPLOY_HOST=peter@schemes.me
 *   VIRITURA_DEPLOY_PATH=/var/www/peter/viritura
 */

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = resolve(root, "dist");

const HOST = process.env.VIRITURA_DEPLOY_HOST ?? "peter@schemes.me";
const REMOTE_PATH = process.env.VIRITURA_DEPLOY_PATH ?? "/var/www/peter/viritura";

// Manual production deploys must never compile the editor's local-development
// API fallback into the public bundle. Cloudflare builds provide this variable
// explicitly; the SSH deployment path supplies the canonical production value.
process.env.VITE_VIRITURA_API_BASE_URL ??= "https://api.viritura.com";

function run(cmd: string, cwd: string = root): void {
  console.log(`\n▸ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env } });
}

console.log("═══ Viritura Deploy ═══");
console.log(`Target: ${HOST}:${REMOTE_PATH}\n`);

const skipWasm = process.argv.includes("--skip-wasm");
const skipBuild = process.argv.includes("--skip-build");

if (skipBuild) {
  console.log("\n── Skipping site build (--skip-build) ──");
  if (!skipWasm) {
    console.log("── Refreshing WASM output ──");
    run("pnpm build:wasm");
  }
} else {
  console.log("\n── 1/2 Site build ──");
  run(skipWasm ? "pnpm build:site -- --skip-wasm" : "pnpm build:site");
}

if (!existsSync(dist)) {
  console.error(`✗ dist/ missing (${dist})`);
  process.exit(1);
}

console.log("\n── 2/2 Upload + atomic swap ──");

// Remote one-shot script: stage → untar → atomic swap → cleanup.
// `set -e` aborts the chain on any failure; live tree is only touched
// after the new content is fully on disk.
const stagingDir = `${REMOTE_PATH}.staging`;
const previousDir = `${REMOTE_PATH}.prev`;
const remoteScript = [
  "set -euo pipefail",
  `rm -rf "${stagingDir}" "${previousDir}"`,
  `mkdir -p "${stagingDir}"`,
  `tar -xzf - -C "${stagingDir}"`,
  `if [ -d "${REMOTE_PATH}" ]; then mv "${REMOTE_PATH}" "${previousDir}"; fi`,
  `mv "${stagingDir}" "${REMOTE_PATH}"`,
  `rm -rf "${previousDir}"`,
  `echo "DEPLOY_OK $(find "${REMOTE_PATH}" -type f | wc -l) files"`,
].join(" && ");

await new Promise<void>((resolveP, rejectP) => {
  const tar = spawn("tar", ["-czf", "-", "-C", dist, "."], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const ssh = spawn("ssh", [HOST, remoteScript], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  tar.stdout!.pipe(ssh.stdin!);

  let firstErr: Error | null = null;
  const fail = (e: Error): void => {
    if (!firstErr) firstErr = e;
  };
  tar.on("error", fail);
  ssh.on("error", fail);

  let tarCode: number | null = null;
  let sshCode: number | null = null;
  const maybeDone = (): void => {
    if (tarCode === null || sshCode === null) return;
    if (firstErr) return rejectP(firstErr);
    if (tarCode !== 0) return rejectP(new Error(`tar exited ${tarCode}`));
    if (sshCode !== 0) return rejectP(new Error(`ssh exited ${sshCode}`));
    resolveP();
  };
  tar.on("close", (c) => {
    tarCode = c;
    maybeDone();
  });
  ssh.on("close", (c) => {
    sshCode = c;
    maybeDone();
  });
});

console.log("\n═══ Deploy complete ═══");
console.log("Live at: https://viritura.com");
console.log("(https://harmonia.peteryang.io is a 301 redirect for back-compat.)");

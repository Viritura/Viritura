#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const DENIGMA_REPOSITORY = "https://github.com/PeterYangIO/denigma.git";
const DENIGMA_COMMIT = "e72b7b75852aec9291a21ebf108452471fccb77f";
const DENIGMA_VERSION = "4.0.0";
const EMSCRIPTEN_IMAGE =
  "emscripten/emsdk:5.0.7@sha256:4e332f7343b6f66320bf72f7ecc01a3d9f3866721a13b0e5c7b96505d6ab148a";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = resolve(root, "build/denigma-wasm");
const denigmaRoot = resolve(buildRoot, "denigma");
const nativeRoot = resolve(root, "packages/musx-import/native");
const outputRoot = resolve(root, "packages/musx-import/assets");
const dependencyRoot = resolve(buildRoot, "build-wasm/_deps");
const resume = process.argv.includes("--resume");

function run(command: string, args: string[], cwd = root): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function checkout(repository: string, commit: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  run("git", ["-c", "core.autocrlf=false", "clone", "--filter=blob:none", "--no-checkout", repository, destination]);
  run("git", ["config", "core.autocrlf", "false"], destination);
  run("git", ["fetch", "origin", commit, "--depth=1"], destination);
  run("git", ["checkout", "--detach", commit], destination);
  verifyCheckout(destination, commit);
}

function verifyCheckout(destination: string, commit: string): void {
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: destination,
    encoding: "utf8",
    windowsHide: true,
  });
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: destination,
    encoding: "utf8",
    windowsHide: true,
  });
  if (head.status !== 0 || head.stdout.trim() !== commit || status.status !== 0 || status.stdout.trim()) {
    throw new Error("The pinned Denigma checkout is not clean.");
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyLicense(source: string, destination: string): void {
  const normalized = readFileSync(source, "utf8")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
  writeFileSync(destination, `${normalized}\n`);
}

if (!resume && existsSync(buildRoot)) {
  // CMake dependencies can contain Unix symlinks that Windows cannot remove.
  // Delete this build's exact contents inside Linux before recreating it.
  run("docker", [
    "run",
    "--rm",
    "--volume",
    `${buildRoot}:/work`,
    EMSCRIPTEN_IMAGE,
    "bash",
    "-lc",
    "find /work -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
  ]);
}
if (resume) {
  verifyCheckout(denigmaRoot, DENIGMA_COMMIT);
} else {
  rmSync(buildRoot, { recursive: true, force: true });
  checkout(DENIGMA_REPOSITORY, DENIGMA_COMMIT, denigmaRoot);
}

run("docker", [
  "run",
  "--rm",
  "--volume",
  `${buildRoot}:/work`,
  "--volume",
  `${nativeRoot}:/source:ro`,
  "--workdir",
  "/source",
  EMSCRIPTEN_IMAGE,
  "bash",
  "-lc",
  [
    "git config --global --add safe.directory /work/denigma",
    `&& test "$(git -C /work/denigma rev-parse HEAD)" = "${DENIGMA_COMMIT}"`,
    '&& test -z "$(git -C /work/denigma status --porcelain)"',
    "&& emcmake cmake -S /source -B /work/build-wasm",
    "-DCMAKE_BUILD_TYPE=MinSizeRel",
    "-DDENIGMA_SOURCE_DIR=/work/denigma",
    `-DDENIGMA_GIT_TAG=${DENIGMA_COMMIT}`,
    `-DVIRITURA_DENIGMA_VERSION=${DENIGMA_VERSION}`,
    `-DVIRITURA_DENIGMA_COMMIT=${DENIGMA_COMMIT}`,
    "&& cmake --build /work/build-wasm --target viritura_denigma_mnx --parallel 2",
    "&& cp /emsdk/upstream/emscripten/LICENSE /work/LICENSE-EMSCRIPTEN.txt",
    "&& cp /emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT /work/LICENSE-MUSL.txt",
    "&& cp /emsdk/upstream/emscripten/system/lib/libcxx/LICENSE.TXT /work/LICENSE-LIBCXX.txt",
  ].join(" "),
]);

run(process.execPath, [
  resolve(root, "packages/musx-import/scripts/smoke.mjs"),
  resolve(buildRoot, "build-wasm/wasm/denigma.js"),
  resolve(denigmaRoot, "tests/data/inputs/barline_short_normal.musx"),
]);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
const moduleSource = resolve(buildRoot, "build-wasm/wasm/denigma.js");
const wasmSource = resolve(buildRoot, "build-wasm/wasm/denigma.wasm");
copyFileSync(moduleSource, resolve(outputRoot, "denigma.js"));
copyFileSync(wasmSource, resolve(outputRoot, "denigma.wasm"));
const licenses = [
  ["DENIGMA", resolve(denigmaRoot, "LICENSE")],
  ["MUSXDOM", resolve(dependencyRoot, "musx-src/LICENSE")],
  ["MNXDOM", resolve(dependencyRoot, "mnxdom-src/LICENSE")],
  ["SMUFL-MAPPING", resolve(dependencyRoot, "smufl_mapping-src/LICENSE")],
  ["BRAVURA-OFL", resolve(dependencyRoot, "smufl_mapping-src/OFL.txt")],
  ["PUGIXML", resolve(dependencyRoot, "pugixml-src/LICENSE.md")],
  ["NLOHMANN-JSON", resolve(dependencyRoot, "nlohmann_json-src/LICENSE.MIT")],
  ["JSON-SCHEMA-VALIDATOR", resolve(dependencyRoot, "json_schema_validator-src/LICENSE")],
  ["ZLIB", resolve(dependencyRoot, "zlib-src/LICENSE")],
  ["EMSCRIPTEN", resolve(buildRoot, "LICENSE-EMSCRIPTEN.txt")],
  ["MUSL", resolve(buildRoot, "LICENSE-MUSL.txt")],
  ["LIBCXX", resolve(buildRoot, "LICENSE-LIBCXX.txt")],
] as const;
for (const [name, source] of licenses) {
  copyLicense(source, resolve(outputRoot, `LICENSE-${name}.txt`));
}
copyFileSync(resolve(dependencyRoot, "smufl_mapping-src/NOTICE.md"), resolve(outputRoot, "NOTICE-SMUFL-MAPPING.md"));

const manifest = {
  denigmaCommit: DENIGMA_COMMIT,
  denigmaVersion: DENIGMA_VERSION,
  emscriptenImage: EMSCRIPTEN_IMAGE,
  moduleSha256: sha256(moduleSource),
  wasmSha256: sha256(wasmSource),
  wasmBytes: readFileSync(wasmSource).byteLength,
};
writeFileSync(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Staged Denigma WASM ${manifest.wasmBytes.toLocaleString()} bytes at ${outputRoot}`);

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(packageRoot, "assets");
const requiredAssets = [
  "denigma.js",
  "denigma.wasm",
  "manifest.json",
  "LICENSE-DENIGMA.txt",
  "LICENSE-BRAVURA-OFL.txt",
  "LICENSE-EMSCRIPTEN.txt",
  "LICENSE-JSON-SCHEMA-VALIDATOR.txt",
  "LICENSE-MNXDOM.txt",
  "LICENSE-MUSXDOM.txt",
  "LICENSE-MUSL.txt",
  "LICENSE-NLOHMANN-JSON.txt",
  "LICENSE-PUGIXML.txt",
  "LICENSE-LIBCXX.txt",
  "LICENSE-SMUFL-MAPPING.txt",
  "LICENSE-ZLIB.txt",
  "NOTICE-SMUFL-MAPPING.md",
] as const;

interface DenigmaAssetManifest {
  moduleSha256: string;
  wasmSha256: string;
  wasmBytes: number;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function syncDenigmaAssets(destination: string): void {
  const missing = requiredAssets.filter((asset) => !existsSync(resolve(assetRoot, asset)));
  if (missing.length > 0) {
    throw new Error(`Denigma WASM assets are missing (${missing.join(", ")}). Run pnpm build:denigma-wasm.`);
  }

  const manifest = JSON.parse(readFileSync(resolve(assetRoot, "manifest.json"), "utf8")) as DenigmaAssetManifest;
  const modulePath = resolve(assetRoot, "denigma.js");
  const wasmPath = resolve(assetRoot, "denigma.wasm");
  const wasmBytes = readFileSync(wasmPath).byteLength;
  if (
    sha256(modulePath) !== manifest.moduleSha256 ||
    sha256(wasmPath) !== manifest.wasmSha256 ||
    wasmBytes !== manifest.wasmBytes
  ) {
    throw new Error("Denigma WASM assets do not match their manifest. Run pnpm build:denigma-wasm.");
  }

  mkdirSync(destination, { recursive: true });
  for (const asset of requiredAssets) {
    const source = resolve(assetRoot, asset);
    const target = resolve(destination, asset);
    if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) {
      copyFileSync(source, target);
    }
  }
}

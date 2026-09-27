/** Runtime files the engine loads by URL, plus the licences that must travel with them. */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const WASM_FILES = ["viritura_wasm.js", "viritura_wasm_bg.wasm"];

const FONTS = [
  "Bravura.otf",
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-Italic.otf",
  "LibertinusSerif-BoldItalic.otf",
];

export function copyFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/** Copy `wasm/` and `fonts/`. Requires a prior `pnpm wasm:build`. */
export function copyEngineAssets(root: string, dest: string): void {
  const wasmDir = resolve(root, "engine/viritura-wasm/pkg-browser");
  for (const name of WASM_FILES) {
    const from = resolve(wasmDir, name);
    if (!existsSync(from)) throw new Error(`Missing ${relative(root, from)}; run \`pnpm wasm:build\` first.`);
    copyFile(from, resolve(dest, "wasm", name));
  }
  for (const name of FONTS) copyFile(resolve(root, "assets/fonts", name), resolve(dest, "fonts", name));
}

export function copyLicenses(root: string, dest: string): void {
  copyFile(resolve(root, "LICENSE"), resolve(dest, "LICENSE"));
  copyFile(resolve(root, "THIRD_PARTY_NOTICES.md"), resolve(dest, "THIRD_PARTY_NOTICES.md"));
  copyFile(resolve(root, "LICENSES/OFL-1.1.txt"), resolve(dest, "LICENSES/OFL-1.1.txt"));
}

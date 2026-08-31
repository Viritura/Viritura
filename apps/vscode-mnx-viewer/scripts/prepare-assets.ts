import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "../..");
const sharedFonts = path.join(repoRoot, "assets", "fonts");
const wasmOutput = path.join(repoRoot, "engine", "viritura-wasm", "pkg-browser");
const mediaDir = path.join(packageDir, "media");

// OFL-licensed font binaries — notices must travel with them in every distribution
const fontFiles = [
  [path.join(sharedFonts, "Bravura.otf"), path.join(mediaDir, "fonts", "Bravura.otf")],
  [path.join(sharedFonts, "LibertinusSerif-Regular.otf"), path.join(mediaDir, "fonts", "LibertinusSerif-Regular.otf")],
  [path.join(sharedFonts, "LibertinusSerif-Bold.otf"), path.join(mediaDir, "fonts", "LibertinusSerif-Bold.otf")],
  [path.join(sharedFonts, "LibertinusSerif-Italic.otf"), path.join(mediaDir, "fonts", "LibertinusSerif-Italic.otf")],
  [
    path.join(sharedFonts, "LibertinusSerif-BoldItalic.otf"),
    path.join(mediaDir, "fonts", "LibertinusSerif-BoldItalic.otf"),
  ],
];

// OFL notices required by every distribution that includes font binaries above
const noticeFiles = [
  [path.join(repoRoot, "THIRD_PARTY_NOTICES.md"), path.join(packageDir, "THIRD_PARTY_NOTICES.md")],
  [path.join(repoRoot, "LICENSES", "OFL-1.1.txt"), path.join(packageDir, "LICENSES", "OFL-1.1.txt")],
];

const files = [
  [path.join(wasmOutput, "viritura_wasm.js"), path.join(mediaDir, "wasm", "viritura_wasm.js")],
  [path.join(wasmOutput, "viritura_wasm_bg.wasm"), path.join(mediaDir, "wasm", "viritura_wasm_bg.wasm")],
  ...fontFiles,
  ...noticeFiles,
];

void (async () => {
  for (const [source, destination] of files) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  console.log(
    `Copied ${files.length} MNX viewer asset files (including OFL notices) to ${path.relative(repoRoot, packageDir)}`,
  );
})();

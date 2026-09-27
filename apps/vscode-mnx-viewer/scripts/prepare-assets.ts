import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaDir = path.join(packageDir, "media");

// The webview renders with the published engine, so its WASM, fonts and
// notices come from the installed `@viritura/score-engine` package rather than
// the workspace Rust build.
const requireFromPackage = createRequire(path.join(packageDir, "package.json"));
const engineDist = path.join(path.dirname(requireFromPackage.resolve("@viritura/score-engine/package.json")), "dist");

// OFL-licensed font binaries — notices must travel with them in every distribution
const fontFiles = [
  "Bravura.otf",
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-Italic.otf",
  "LibertinusSerif-BoldItalic.otf",
].map((file) => [path.join(engineDist, "fonts", file), path.join(mediaDir, "fonts", file)]);

// OFL notices required by every distribution that includes font binaries above
const noticeFiles = [
  [path.join(engineDist, "THIRD_PARTY_NOTICES.md"), path.join(packageDir, "THIRD_PARTY_NOTICES.md")],
  [path.join(engineDist, "LICENSES", "OFL-1.1.txt"), path.join(packageDir, "LICENSES", "OFL-1.1.txt")],
];

const files = [
  ...["viritura_wasm.js", "viritura_wasm_bg.wasm"].map((file) => [
    path.join(engineDist, "wasm", file),
    path.join(mediaDir, "wasm", file),
  ]),
  ...fontFiles,
  ...noticeFiles,
];

void (async () => {
  for (const [source, destination] of files) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  console.log(`Copied ${files.length} MNX viewer asset files (including OFL notices) from ${engineDist}`);
})();

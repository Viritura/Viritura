import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedExampleFilenames } from "../src/routes/mnx-playground/publishedExamples";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(websiteRoot, "../..");
const sharedFonts = resolve(repoRoot, "assets/fonts");
const sharedBranding = resolve(repoRoot, "assets/branding");
const mnxSchema = resolve(repoRoot, "packages/format/schemas/mnx-schema.json");
const mnxFixtures = resolve(repoRoot, "packages/format/fixtures/mnx");
const wasmOutput = resolve(repoRoot, "engine/viritura-wasm/pkg-browser");
const websitePublic = resolve(websiteRoot, "public");

const wasmFiles = ["viritura_wasm_bg.wasm", "viritura_wasm.js", "viritura_wasm.d.ts", "viritura_wasm_bg.wasm.d.ts"];
const fontFiles = [
  "Bravura.otf",
  "bravura_metadata.json",
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-Italic.otf",
  "LibertinusSerif-BoldItalic.otf",
];

mkdirSync(resolve(websitePublic, "wasm"), { recursive: true });
mkdirSync(resolve(websitePublic, "fonts"), { recursive: true });
rmSync(resolve(websitePublic, "mnx-samples"), { recursive: true, force: true });
mkdirSync(resolve(websitePublic, "mnx-samples"), { recursive: true });
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Sound asset staging must run from a pnpm command");
execFileSync(
  process.execPath,
  [pnpmCli, "--filter", "@viritura/audio", "stage-sounds", resolve(websitePublic, "sounds")],
  { cwd: repoRoot, stdio: "inherit" },
);

for (const file of wasmFiles) {
  copyFileSync(resolve(wasmOutput, file), resolve(websitePublic, "wasm", file));
}
for (const file of fontFiles) {
  copyFileSync(resolve(sharedFonts, file), resolve(websitePublic, "fonts", file));
}
for (const file of ["favicon.svg", "viritura-logo.svg", "viritura-mark.svg"]) {
  copyFileSync(resolve(sharedBranding, file), resolve(websitePublic, file));
}
copyFileSync(mnxSchema, resolve(websitePublic, "mnx-schema.json"));
for (const filename of publishedExampleFilenames) {
  copyFileSync(resolve(mnxFixtures, filename), resolve(websitePublic, "mnx-samples", filename));
}

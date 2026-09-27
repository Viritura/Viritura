import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedExampleFilenames } from "../src/routes/mnx-playground/publishedExamples";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(websiteRoot, "../..");
const sharedBranding = resolve(repoRoot, "assets/branding");
const mnxSchema = resolve(repoRoot, "packages/format/schemas/mnx-schema.json");
const mnxFixtures = resolve(repoRoot, "packages/format/fixtures/mnx");
const websitePublic = resolve(websiteRoot, "public");

// The website renders with the published engine, so its WASM, fonts and worker
// come from the installed package rather than the workspace Rust build. They
// are staged under a version-specific directory so they can be cached
// immutably and never mix with a different engine release. Keep this path in
// step with `src/scoreEngineAssets.ts`.
const requireFromWebsite = createRequire(resolve(websiteRoot, "package.json"));
const enginePackageJson = requireFromWebsite.resolve("@viritura/score-engine/package.json");
const engineDist = resolve(dirname(enginePackageJson), "dist");
const engineVersion = (JSON.parse(readFileSync(enginePackageJson, "utf8")) as { version: string }).version;
const engineAssets = resolve(websitePublic, "score-engine");

rmSync(engineAssets, { recursive: true, force: true });
mkdirSync(resolve(engineAssets, engineVersion), { recursive: true });
for (const entry of ["wasm", "fonts", "LICENSES", "score-engine.worker.js", "THIRD_PARTY_NOTICES.md"]) {
  cpSync(resolve(engineDist, entry), resolve(engineAssets, engineVersion, entry), { recursive: true });
}
rmSync(resolve(websitePublic, "mnx-samples"), { recursive: true, force: true });
mkdirSync(resolve(websitePublic, "mnx-samples"), { recursive: true });
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Sound asset staging must run from a pnpm command");
execFileSync(
  process.execPath,
  [pnpmCli, "--filter", "@viritura/audio", "stage-sounds", resolve(websitePublic, "sounds")],
  { cwd: repoRoot, stdio: "inherit" },
);

for (const file of ["favicon.svg", "viritura-logo.svg", "viritura-mark.svg"]) {
  copyFileSync(resolve(sharedBranding, file), resolve(websitePublic, file));
}
copyFileSync(mnxSchema, resolve(websitePublic, "mnx-schema.json"));
for (const filename of publishedExampleFilenames) {
  copyFileSync(resolve(mnxFixtures, filename), resolve(websitePublic, "mnx-samples", filename));
}

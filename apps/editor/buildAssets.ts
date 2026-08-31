import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const editorRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(editorRoot, "../..");
const sharedFonts = resolve(repoRoot, "assets/fonts");
const sharedBranding = resolve(repoRoot, "assets/branding");
const publicFonts = resolve(editorRoot, "public/fonts");
const mnxSchema = resolve(repoRoot, "packages/format/schemas/mnx-schema.json");
const mnxFixtures = resolve(repoRoot, "packages/format/fixtures/mnx");
const publicScores = resolve(editorRoot, "public/scores");
const sharedAssetStageLock = resolve(editorRoot, "node_modules/.cache/viritura-shared-assets.lock");
const fixtureStageLock = resolve(editorRoot, "node_modules/.cache/viritura-mnx-fixtures.lock");
const FONT_ASSETS = [
  "Anybody-700.ttf",
  "BodoniModa-600.ttf",
  "Bravura.otf",
  "BravuraText.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-BoldItalic.otf",
  "LibertinusSerif-Italic.otf",
  "LibertinusSerif-Regular.otf",
  "bravura_metadata.json",
];
const BRANDING_ASSETS = ["favicon.svg", "viritura-logo.svg", "viritura-mark.svg"];
const lockWaiter = new Int32Array(new SharedArrayBuffer(4));

export function syncSharedAssets(): void {
  withStageLock(sharedAssetStageLock, () => {
    mkdirSync(publicFonts, { recursive: true });
    for (const asset of FONT_ASSETS) {
      copyFileSync(resolve(sharedFonts, asset), resolve(publicFonts, asset));
    }
    for (const asset of BRANDING_ASSETS) {
      copyFileSync(resolve(sharedBranding, asset), resolve(editorRoot, "public", asset));
    }
  });
}

export function syncSounds(): void {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("Sound asset staging must run from a pnpm command");
  execFileSync(
    process.execPath,
    [pnpmCli, "--filter", "@viritura/audio", "stage-sounds", resolve(editorRoot, "public/sounds")],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

export function syncMnxSchema(): void {
  copyFileSync(mnxSchema, resolve(editorRoot, "public/mnx-schema.json"));
}

export function syncMnxFixtures(): void {
  withStageLock(fixtureStageLock, () => {
    rmSync(publicScores, { force: true, recursive: true });
    cpSync(mnxFixtures, publicScores, { recursive: true });
  });
}

function withStageLock(stageLock: string, sync: () => void): void {
  mkdirSync(dirname(stageLock), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(stageLock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 400) throw error;
      Atomics.wait(lockWaiter, 0, 0, 25);
    }
  }

  try {
    sync();
  } finally {
    rmSync(stageLock, { force: true, recursive: true });
  }
}

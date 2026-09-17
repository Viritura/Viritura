import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Desktop frontend preparation must run from a pnpm command");

// Set this before Turbo starts so desktop and browser assets have distinct cache keys.
const env = { ...process.env, VIRITURA_EXTERNAL_SOUNDFONT: "true" };
for (const args of [["build:wasm"], ["turbo", "run", "build", "--filter=@viritura/editor"]]) {
  execFileSync(process.execPath, [pnpmCli, ...args], { cwd: root, env, stdio: "inherit" });
}

// Cache restoration need not remove a SoundFont left by an earlier browser build.
// Enforce the single-copy desktop artifact even when Vite's closeBundle hook did not run.
rmSync(resolve(root, "apps", "editor", "dist", "sounds", "Shan-SGM-Pro-15.sf2"), { force: true });

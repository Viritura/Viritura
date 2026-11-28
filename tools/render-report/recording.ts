import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export const TARGET = join(import.meta.dirname, "target");
const VIRITURA = resolve(import.meta.dirname, "../..");
const RECORDING = join(TARGET, "recording");
const MANIFEST = join(RECORDING, "manifest.jsonl");
const PICTURES = join(RECORDING, "pictures");
const RECORDINGS = join(TARGET, "recordings");

export interface Rendering {
  name: string;
  mnx: string;
  pages: string[];
}

interface ManifestEntry {
  test: string;
  call: number;
  mnx: string;
  pages: string[];
}

/** Runs the engine tests matching `filters` (all of them when empty) and returns the manifest of what they drew. */
export function recordTests(filters: string[]): string {
  rmSync(MANIFEST, { force: true });
  const args = ["test", "-p", "viritura-engine", "--lib", "--quiet", "--", ...filters];
  const { status } = spawnSync("cargo", args, {
    cwd: join(VIRITURA, "engine"),
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, RENDER_RECORDING: RECORDING },
  });
  if (!existsSync(MANIFEST)) throw new Error("No test drew anything");
  if (status !== 0) console.warn("Some tests fail");
  return MANIFEST;
}

export function readManifest(manifest: string): Rendering[] {
  const lines = readFileSync(manifest, "utf8").trim().split("\n");
  return lines
    .map((line) => JSON.parse(line) as ManifestEntry)
    .map(({ test, call, mnx, pages }) => ({
      name: `${test} #${call}`,
      mnx: join(PICTURES, mnx),
      pages: pages.map((page) => join(PICTURES, page)),
    }));
}

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en", { numeric: true });
}

export function recordingOf(tree: string): string {
  mkdirSync(RECORDINGS, { recursive: true });
  return join(RECORDINGS, `${tree}.jsonl`);
}

export function treeOf(ref: string): string {
  return git(["rev-parse", "--verify", `${ref}^{tree}`]).trim();
}

/** The tree that committing every change in the working tree would create. */
export function workingTree(): string {
  mkdirSync(TARGET, { recursive: true });
  const index = join(TARGET, "git-index");
  copyFileSync(resolve(VIRITURA, git(["rev-parse", "--git-path", "index"]).trim()), index);
  const env = { GIT_INDEX_FILE: index };
  git(["add", "--all"], env);
  const tree = git(["write-tree"], env).trim();
  rmSync(index);
  return tree;
}

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", ["-C", VIRITURA, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

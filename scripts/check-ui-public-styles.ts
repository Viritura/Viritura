#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const privateStylePrefix = "@viritura/ui/" + "src/";
const publicStyles = ["@viritura/ui/tokens.css", "@viritura/ui/reset.css"];
const consumerRoots = ["apps/editor", "apps/server-ui", "apps/website"];
const scannedExtensions = new Set([".css", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
  "storybook-static",
  "storybook-mnx-static",
]);

const violations: string[] = [];

function scan(directory: string): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!ignoredDirectories.has(entry)) scan(path);
      continue;
    }
    const extension = entry.slice(entry.lastIndexOf("."));
    if (!scannedExtensions.has(extension)) continue;
    if (readFileSync(path, "utf8").includes(privateStylePrefix)) {
      violations.push(`${relative(repoRoot, path).split(sep).join("/")}: private UI stylesheet import`);
    }
  }
}

for (const sourceRoot of ["apps", "packages"]) {
  scan(join(repoRoot, sourceRoot));
}

for (const consumerRoot of consumerRoots) {
  const consumerPackage = join(repoRoot, consumerRoot, "package.json");
  if (!existsSync(consumerPackage)) continue;
  const resolveFromConsumer = createRequire(consumerPackage);
  for (const publicStyle of publicStyles) {
    try {
      resolveFromConsumer.resolve(publicStyle);
    } catch {
      violations.push(`${consumerRoot}: cannot resolve ${publicStyle}`);
    }
  }
}

if (violations.length > 0) {
  console.error("UI public stylesheet boundary violations:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("UI public stylesheet exports resolve from every consumer.");

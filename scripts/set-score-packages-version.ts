#!/usr/bin/env node
/**
 * Set or check the shared version of the three score packages.
 *
 *   pnpm version:score-packages 0.2.0   write the version everywhere it lives
 *   pnpm version:score-packages --check print it, failing if anything disagrees
 *   pnpm version:score-packages --check --tag score-engine-v0.2.0
 *                                        also require the release tag to match
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setSharedVersion, sharedVersion } from "./score-packages/packageVersions";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAG_PREFIX = "score-engine-v";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function main(args: readonly string[]): void {
  if (args[0] === "--check") {
    const version = sharedVersion(root);
    const tagIndex = args.indexOf("--tag");
    if (tagIndex >= 0) {
      const tag = args[tagIndex + 1] ?? "";
      if (tag !== `${TAG_PREFIX}${version}`) {
        throw new Error(`Tag ${tag || "(missing)"} does not match package version ${version}`);
      }
    }
    console.log(version);
    return;
  }
  const version = args[0];
  if (!version || !SEMVER.test(version)) {
    throw new Error("Usage: pnpm version:score-packages <semver> | --check [--tag <tag>]");
  }
  setSharedVersion(root, version);
  console.log(`Score packages set to ${sharedVersion(root)}. Add a CHANGELOG entry to each package.`);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

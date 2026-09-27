/**
 * The three score packages are released together under one version, so a
 * viewer always runs against the engine it was tested with.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const SCORE_PACKAGES = ["score-engine", "score-viewer", "score-viewer-react"] as const;
export type ScorePackage = (typeof SCORE_PACKAGES)[number];

/** Source constant the engine reports as `engine.version.package`. */
const VERSION_CONSTANT = "packages/score-engine/src/buildInfo.ts";
const VERSION_CONSTANT_PATTERN = /export const PACKAGE_VERSION = "([^"]+)";/;

export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifestPath(root: string, pkg: ScorePackage): string {
  return resolve(root, "packages", pkg, "package.json");
}

export function readManifest(root: string, pkg: ScorePackage): PackageManifest {
  return JSON.parse(readFileSync(manifestPath(root, pkg), "utf8")) as PackageManifest;
}

/** Return the shared version, or throw if the packages or the engine constant disagree. */
export function sharedVersion(root: string): string {
  const versions = new Map<string, string>();
  for (const pkg of SCORE_PACKAGES) versions.set(`@viritura/${pkg}`, readManifest(root, pkg).version);
  const constant = VERSION_CONSTANT_PATTERN.exec(readFileSync(resolve(root, VERSION_CONSTANT), "utf8"))?.[1];
  versions.set(`${VERSION_CONSTANT} PACKAGE_VERSION`, constant ?? "(missing)");
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    const listing = [...versions].map(([name, v]) => `  ${name}: ${v}`).join("\n");
    throw new Error(`Score packages must share one version:\n${listing}`);
  }
  return [...distinct][0]!;
}

export function setSharedVersion(root: string, version: string): void {
  for (const pkg of SCORE_PACKAGES) {
    const path = manifestPath(root, pkg);
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  }
  const path = resolve(root, VERSION_CONSTANT);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(VERSION_CONSTANT_PATTERN, `export const PACKAGE_VERSION = "${version}";`),
  );
}

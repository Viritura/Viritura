/**
 * Each score package is versioned and released on its own, and npm is the
 * source of truth for released versions: the repository carries the
 * placeholder DEV_VERSION, and the release workflow stamps real versions into
 * its checkout before building. The viewers depend on siblings through
 * `workspace:^`, which `pnpm pack` turns into a caret range on the stamped
 * version.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Dependency order: each package only depends on packages before it. */
export const SCORE_PACKAGES = ["score-engine", "score-viewer", "score-viewer-react"] as const;
export type ScorePackage = (typeof SCORE_PACKAGES)[number];

/** Version the workspace carries between releases. */
export const DEV_VERSION = "0.0.0-dev";

/** Source constant the engine reports as `engine.version.package`. */
const VERSION_CONSTANT = "packages/score-engine/src/buildInfo.ts";
const VERSION_CONSTANT_PATTERN = /export const PACKAGE_VERSION = "([^"]+)";/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Range the viewers must use for sibling score packages. */
const SIBLING_RANGE = "workspace:^";

export interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function isScorePackage(value: string): value is ScorePackage {
  return (SCORE_PACKAGES as readonly string[]).includes(value);
}

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}

function manifestPath(root: string, pkg: ScorePackage): string {
  return resolve(root, "packages", pkg, "package.json");
}

export function readManifest(root: string, pkg: ScorePackage): PackageManifest {
  return JSON.parse(readFileSync(manifestPath(root, pkg), "utf8")) as PackageManifest;
}

/** Score packages `pkg` depends on directly. */
export function siblingDependencies(root: string, pkg: ScorePackage): ScorePackage[] {
  return Object.keys(readManifest(root, pkg).dependencies ?? {})
    .map((name) => name.replace(/^@viritura\//, ""))
    .filter(isScorePackage);
}

/** Each package's version, after checking the invariants the release depends on. */
export function packageVersions(root: string): Record<ScorePackage, string> {
  const versions = {} as Record<ScorePackage, string>;
  const problems: string[] = [];
  for (const pkg of SCORE_PACKAGES) {
    const manifest = readManifest(root, pkg);
    versions[pkg] = manifest.version;
    if (!isSemver(manifest.version)) problems.push(`@viritura/${pkg}: version ${manifest.version} is not semver`);
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (isScorePackage(name.replace(/^@viritura\//, "")) && range !== SIBLING_RANGE) {
        problems.push(`@viritura/${pkg}: ${name} must be "${SIBLING_RANGE}", found "${range}"`);
      }
    }
  }
  const constant = VERSION_CONSTANT_PATTERN.exec(readFileSync(resolve(root, VERSION_CONSTANT), "utf8"))?.[1];
  if (constant !== versions["score-engine"]) {
    problems.push(
      `${VERSION_CONSTANT} PACKAGE_VERSION is ${constant ?? "(missing)"}, expected ${versions["score-engine"]}`,
    );
  }
  if (problems.length) throw new Error(`Score package versions are inconsistent:\n  ${problems.join("\n  ")}`);
  return versions;
}

export function setPackageVersion(root: string, pkg: ScorePackage, version: string): void {
  const path = manifestPath(root, pkg);
  writeFileSync(path, readFileSync(path, "utf8").replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  if (pkg !== "score-engine") return;
  const constant = resolve(root, VERSION_CONSTANT);
  writeFileSync(
    constant,
    readFileSync(constant, "utf8").replace(VERSION_CONSTANT_PATTERN, `export const PACKAGE_VERSION = "${version}";`),
  );
}

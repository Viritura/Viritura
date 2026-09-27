/**
 * Work out what a release run publishes. Stable releases bump the selected
 * packages from their latest npm release; the rest keep their npm version so
 * the viewers' caret ranges point at something installable. Engine
 * prereleases (`planPrerelease`) publish every engine change under the `next`
 * dist-tag without touching stable versions.
 */

import { execFileSync } from "node:child_process";
import {
  isSemver,
  packageVersions,
  SCORE_PACKAGES,
  setPackageVersion,
  siblingDependencies,
  type ScorePackage,
} from "./packageVersions";

export const BUMPS = ["skip", "patch", "minor", "major"] as const;
export type Bump = (typeof BUMPS)[number];

/** The `0.0.0` versions on npm only reserve the package names. */
const PLACEHOLDER = "0.0.0";

interface Release {
  pkg: ScorePackage;
  version: string;
  /** Tag of this package's previous release, for release notes. */
  previousTag: string | null;
  /** True when an earlier attempt of this run already published the version. */
  published: boolean;
}

export interface ReleasePlan {
  /** npm dist-tag: `latest` for stable releases, `next` for engine prereleases. */
  distTag: "latest" | "next";
  releases: Release[];
  /** Unreleased dependencies of a release, installed from npm when verifying. */
  registry: { pkg: ScorePackage; version: string }[];
  versions: Record<ScorePackage, string>;
}

/** Registry and git lookups, injectable so the plan logic is testable offline. */
export interface ReleaseSources {
  latest(pkg: ScorePackage): string | null;
  isPublished(pkg: ScorePackage, version: string): boolean;
  dependencies(pkg: ScorePackage, version: string): Record<string, string>;
  tags(pkg: ScorePackage): string[];
  tagsAtHead(): string[];
}

function parse(version: string): [number, number, number] {
  const [major, minor, patch] = version.split("-")[0]!.split(".").map(Number);
  return [major!, minor!, patch!];
}

export function bumpVersion(latest: string | null, bump: Exclude<Bump, "skip">): string {
  const [major, minor, patch] = parse(latest ?? PLACEHOLDER);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Whether `version` satisfies a caret range such as `^0.2.0`. */
export function satisfiesCaret(range: string, version: string): boolean {
  if (!range.startsWith("^") || !isSemver(range.slice(1))) return range === version;
  // npm only matches prereleases against a range that names one on the same major.minor.patch.
  if (version.includes("-") && !range.includes("-")) return false;
  const [lo, v] = [parse(range.slice(1)), parse(version)];
  const cmp = v[0] - lo[0] || v[1] - lo[1] || v[2] - lo[2];
  if (cmp < 0) return false;
  if (lo[0] > 0) return v[0] === lo[0];
  if (lo[1] > 0) return v[0] === 0 && v[1] === lo[1];
  return v[0] === 0 && v[1] === 0 && v[2] === lo[2];
}

function upstreamOf(root: string, pkg: ScorePackage): Set<ScorePackage> {
  const seen = new Set<ScorePackage>();
  const visit = (p: ScorePackage): void => {
    for (const dep of siblingDependencies(root, p)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      visit(dep);
    }
  };
  visit(pkg);
  return seen;
}

export function planRelease(root: string, bumps: Record<ScorePackage, Bump>, sources: ReleaseSources): ReleasePlan {
  packageVersions(root);
  const selected = SCORE_PACKAGES.filter((pkg) => bumps[pkg] !== "skip");
  if (!selected.length) throw new Error("Select at least one package to release.");

  const versions = {} as Record<ScorePackage, string>;
  const latest = {} as Record<ScorePackage, string | null>;
  const releases: Release[] = [];
  const headTags = new Set(sources.tagsAtHead());
  for (const pkg of SCORE_PACKAGES) {
    const onNpm = sources.latest(pkg);
    latest[pkg] = onNpm && onNpm !== PLACEHOLDER ? onNpm : null;
    const bump = bumps[pkg];
    if (bump === "skip") {
      versions[pkg] = latest[pkg] ?? PLACEHOLDER;
      continue;
    }
    // A re-run of a partly failed release reuses the version already tagged at this commit.
    const retagged = [...headTags].find((tag) => tag.startsWith(`${pkg}-v`))?.slice(pkg.length + 2);
    const version = retagged ?? bumpVersion(latest[pkg], bump);
    const published = sources.isPublished(pkg, version);
    if (published && !retagged) throw new Error(`@viritura/${pkg}@${version} is already on npm.`);
    versions[pkg] = version;
    const previousTag = sources.tags(pkg).find((tag) => tag !== `${pkg}-v${version}`) ?? null;
    releases.push({ pkg, version, previousTag, published });
  }

  const registry: ReleasePlan["registry"] = [];
  const problems: string[] = [];
  const upstream = new Set(selected.flatMap((pkg) => [...upstreamOf(root, pkg)]));
  for (const dep of SCORE_PACKAGES.filter((pkg) => upstream.has(pkg) && bumps[pkg] === "skip")) {
    if (!latest[dep]) {
      problems.push(`@viritura/${dep} has never been released; select it too.`);
      continue;
    }
    registry.push({ pkg: dep, version: latest[dep] });
    // An installed-from-npm dependency must accept the versions released alongside it.
    for (const [name, range] of Object.entries(sources.dependencies(dep, latest[dep]))) {
      const sibling = name.replace(/^@viritura\//, "") as ScorePackage;
      if (bumps[sibling] && bumps[sibling] !== "skip" && !satisfiesCaret(range, versions[sibling])) {
        problems.push(
          `@viritura/${dep}@${latest[dep]} requires ${name}@${range}, which excludes ${versions[sibling]}; select ${dep} too.`,
        );
      }
    }
  }
  if (problems.length) throw new Error(`Cannot release:\n  ${problems.join("\n  ")}`);
  return { distTag: "latest", releases, registry, versions };
}

/**
 * The engine prerelease for workflow run `run`: `<next patch>-next.<run>`, or
 * `0.1.0-next.<run>` before the first stable release. Prereleases sort below
 * the stable version they lead up to, and caret ranges never match them, so
 * `npm install` and the viewers' ranges keep resolving stable engines.
 */
export function planPrerelease(root: string, run: number, sources: ReleaseSources): ReleasePlan {
  packageVersions(root);
  if (!Number.isInteger(run) || run < 1) throw new Error(`Run number must be a positive integer, got ${run}.`);
  const versions = {} as Record<ScorePackage, string>;
  for (const pkg of SCORE_PACKAGES) {
    const onNpm = sources.latest(pkg);
    versions[pkg] = onNpm && onNpm !== PLACEHOLDER ? onNpm : PLACEHOLDER;
  }
  const stable = versions["score-engine"] === PLACEHOLDER ? null : versions["score-engine"];
  const version = `${stable ? bumpVersion(stable, "patch") : bumpVersion(null, "minor")}-next.${run}`;
  versions["score-engine"] = version;
  return {
    distTag: "next",
    releases: [
      { pkg: "score-engine", version, previousTag: null, published: sources.isPublished("score-engine", version) },
    ],
    registry: [],
    versions,
  };
}

export function applyPlan(root: string, plan: ReleasePlan): void {
  for (const pkg of SCORE_PACKAGES) setPackageVersion(root, pkg, plan.versions[pkg]);
  packageVersions(root);
}

function capture(cmd: string, args: string[]): string {
  // npm is a .cmd shim on Windows, which only runs through cmd.exe. The arguments are package names and versions.
  const [file, argv] =
    process.platform === "win32" && cmd === "npm"
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", cmd, ...args]]
      : [cmd, args];
  try {
    return execFileSync(file, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function npmJson(spec: string, field: string): unknown {
  const out = capture("npm", ["view", spec, field, "--json"]);
  return out ? (JSON.parse(out) as unknown) : null;
}

export const liveSources: ReleaseSources = {
  latest: (pkg) => (npmJson(`@viritura/${pkg}`, "dist-tags.latest") as string | null) ?? null,
  isPublished: (pkg, version) => npmJson(`@viritura/${pkg}@${version}`, "version") === version,
  dependencies: (pkg, version) =>
    (npmJson(`@viritura/${pkg}@${version}`, "dependencies") as Record<string, string> | null) ?? {},
  tags: (pkg) =>
    capture("git", ["tag", "--list", `${pkg}-v*`, "--sort=-v:refname"])
      .split("\n")
      .filter(Boolean),
  tagsAtHead: () => capture("git", ["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean),
};

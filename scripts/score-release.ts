#!/usr/bin/env node
/**
 * Plan and stamp score package releases. npm holds the released versions;
 * the repository carries 0.0.0-dev (scripts/score-packages/packageVersions.ts).
 *
 *   pnpm score-release check
 *        fail if the workspace breaks the release invariants or carries a
 *        version other than 0.0.0-dev
 *   pnpm score-release plan --score-engine minor --score-viewer patch [--apply] [--out plan.json]
 *        print the versions a release would publish (`skip|patch|minor|major`
 *        per package, default skip); --apply writes them into this checkout,
 *        --out saves the plan for the release workflow
 *   pnpm score-release next --run <n> [--apply] [--out plan.json]
 *        plan the engine prerelease `<next patch>-next.<n>` published on
 *        every engine change
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_VERSION, packageVersions, SCORE_PACKAGES, type ScorePackage } from "./score-packages/packageVersions";
import {
  applyPlan,
  BUMPS,
  liveSources,
  planPrerelease,
  planRelease,
  type Bump,
  type ReleasePlan,
} from "./score-packages/releasePlan";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage: pnpm score-release check | next --run <n> | plan ${SCORE_PACKAGES.map((p) => `[--${p} <${BUMPS.join("|")}>]`).join(" ")} [--apply] [--out <file>]`;

function option(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args: readonly string[]): void {
  if (args[0] === "check") {
    const versions = packageVersions(root);
    const stamped = SCORE_PACKAGES.filter((pkg) => versions[pkg] !== DEV_VERSION);
    if (stamped.length) {
      throw new Error(
        `Leave score package versions at ${DEV_VERSION}; the publish workflow stamps releases (${stamped.map((p) => `${p}@${versions[p]}`).join(", ")}).`,
      );
    }
    console.log("Score package versions are consistent.");
    return;
  }
  let plan: ReleasePlan;
  if (args[0] === "next") {
    plan = planPrerelease(root, Number(option(args, "--run")), liveSources);
  } else if (args[0] === "plan") {
    const bumps = {} as Record<ScorePackage, Bump>;
    for (const pkg of SCORE_PACKAGES) {
      const bump = option(args, `--${pkg}`) ?? "skip";
      if (!(BUMPS as readonly string[]).includes(bump)) throw new Error(USAGE);
      bumps[pkg] = bump as Bump;
    }
    plan = planRelease(root, bumps, liveSources);
  } else {
    throw new Error(USAGE);
  }
  for (const r of plan.releases) {
    console.error(`release  @viritura/${r.pkg}@${r.version}${r.published ? " (already on npm)" : ""}`);
  }
  for (const r of plan.registry) console.error(`from npm @viritura/${r.pkg}@${r.version}`);
  const out = option(args, "--out");
  if (out) writeFileSync(resolve(out), JSON.stringify(plan, null, 2) + "\n");
  if (args.includes("--apply")) applyPlan(root, plan);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

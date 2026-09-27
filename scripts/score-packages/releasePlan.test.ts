import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ScorePackage } from "./packageVersions";
import { bumpVersion, planRelease, satisfiesCaret, type Bump, type ReleaseSources } from "./releasePlan";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Registry {
  latest?: Partial<Record<ScorePackage, string>>;
  deps?: Record<string, Record<string, string>>;
  tags?: Partial<Record<ScorePackage, string[]>>;
  head?: string[];
}

function sources(registry: Registry): ReleaseSources {
  const latest = {
    "score-engine": "0.0.0",
    "score-viewer": "0.0.0",
    "score-viewer-react": "0.0.0",
    ...registry.latest,
  };
  return {
    latest: (pkg) => latest[pkg],
    isPublished: (pkg, version) => latest[pkg] === version,
    dependencies: (pkg, version) => registry.deps?.[`${pkg}@${version}`] ?? {},
    tags: (pkg) => registry.tags?.[pkg] ?? [],
    tagsAtHead: () => registry.head ?? [],
  };
}

function bumps(partial: Partial<Record<ScorePackage, Bump>>): Record<ScorePackage, Bump> {
  return { "score-engine": "skip", "score-viewer": "skip", "score-viewer-react": "skip", ...partial };
}

test("bumps from the latest npm release, treating the 0.0.0 placeholder as unreleased", () => {
  assert.equal(bumpVersion(null, "minor"), "0.1.0");
  assert.equal(bumpVersion("0.1.3", "patch"), "0.1.4");
  assert.equal(bumpVersion("0.1.3", "minor"), "0.2.0");
  assert.equal(bumpVersion("0.4.1", "major"), "1.0.0");
});

test("caret ranges follow npm's 0.x rules", () => {
  assert.ok(satisfiesCaret("^0.2.0", "0.2.5"));
  assert.ok(!satisfiesCaret("^0.2.0", "0.3.0"));
  assert.ok(satisfiesCaret("^1.2.0", "1.9.0"));
  assert.ok(!satisfiesCaret("^1.2.0", "2.0.0"));
  assert.ok(!satisfiesCaret("^0.0.3", "0.0.4"));
});

test("releases the engine alone, keeping the viewers at their npm versions", () => {
  const plan = planRelease(root, bumps({ "score-engine": "minor" }), sources({ latest: { "score-engine": "0.1.0" } }));
  assert.deepEqual(
    plan.releases.map((r) => `${r.pkg}@${r.version}`),
    ["score-engine@0.2.0"],
  );
  assert.deepEqual(plan.registry, []);
  assert.equal(plan.versions["score-viewer"], "0.0.0");
});

test("installs unselected dependencies from npm when verifying a viewer release", () => {
  const plan = planRelease(
    root,
    bumps({ "score-viewer-react": "patch" }),
    sources({
      latest: { "score-engine": "0.3.0", "score-viewer": "0.2.0", "score-viewer-react": "0.2.0" },
      tags: { "score-viewer-react": ["score-viewer-react-v0.2.0"] },
    }),
  );
  assert.deepEqual(plan.releases, [
    { pkg: "score-viewer-react", version: "0.2.1", previousTag: "score-viewer-react-v0.2.0", published: false },
  ]);
  assert.deepEqual(plan.registry, [
    { pkg: "score-engine", version: "0.3.0" },
    { pkg: "score-viewer", version: "0.2.0" },
  ]);
});

test("refuses a viewer release before its engine has ever been released", () => {
  assert.throws(
    () => planRelease(root, bumps({ "score-viewer": "minor" }), sources({})),
    /score-engine has never been released/,
  );
});

test("refuses a release that would leave an npm dependency on an excluded engine", () => {
  assert.throws(
    () =>
      planRelease(
        root,
        bumps({ "score-engine": "minor", "score-viewer-react": "patch" }),
        sources({
          latest: { "score-engine": "0.1.0", "score-viewer": "0.1.0", "score-viewer-react": "0.1.0" },
          deps: { "score-viewer@0.1.0": { "@viritura/score-engine": "^0.1.0" } },
        }),
      ),
    /score-viewer@0.1.0 requires @viritura\/score-engine@\^0.1.0, which excludes 0.2.0; select score-viewer too/,
  );
});

test("a re-run reuses the version already tagged at this commit", () => {
  const plan = planRelease(
    root,
    bumps({ "score-engine": "minor", "score-viewer": "minor" }),
    sources({
      latest: { "score-engine": "0.2.0", "score-viewer": "0.1.0" },
      tags: { "score-engine": ["score-engine-v0.2.0", "score-engine-v0.1.0"] },
      head: ["score-engine-v0.2.0"],
    }),
  );
  assert.deepEqual(plan.releases, [
    { pkg: "score-engine", version: "0.2.0", previousTag: "score-engine-v0.1.0", published: true },
    { pkg: "score-viewer", version: "0.2.0", previousTag: null, published: false },
  ]);
});

test("refuses to select nothing", () => {
  assert.throws(() => planRelease(root, bumps({}), sources({})), /Select at least one package/);
});

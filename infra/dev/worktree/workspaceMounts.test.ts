import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dependencyVolumeSuffixes } from "./stack.ts";

const worktreeDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(worktreeDirectory, "..", "..", "..");
const dockerfile = readFileSync(join(worktreeDirectory, "dev.Dockerfile"), "utf8");
const compose = readFileSync(join(worktreeDirectory, "docker-compose.yml"), "utf8");

function workspacePackages(): string[] {
  return ["apps", "packages", "examples"].flatMap((group) =>
    readdirSync(join(repositoryRoot, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(repositoryRoot, group, entry.name, "package.json")))
      .map((entry) => `${group}/${entry.name}`),
  );
}

// A workspace package missing from the image falls back to host-created
// pnpm links, which point at host paths the container cannot resolve.
test("every workspace package is installed into the dev image", () => {
  for (const directory of workspacePackages()) {
    assert.ok(
      dockerfile.includes(`COPY ${directory}/package.json ./${directory}/package.json`),
      `dev.Dockerfile does not copy ${directory}/package.json`,
    );
  }
});

test("every workspace package mounts its image node_modules", () => {
  for (const directory of workspacePackages()) {
    assert.ok(
      compose.includes(`:/workspace/${directory}/node_modules:ro`),
      `docker-compose.yml does not mount ${directory}/node_modules`,
    );
  }
});

test("compose dependency volumes match the volumes the stack creates", () => {
  const composeSuffixes = [
    ...compose.matchAll(/name: viritura-dev-node-\$\{VIRITURA_DEPENDENCY_HASH\}-([a-z0-9-]+)/g),
  ].map((match) => match[1]);
  assert.deepEqual([...composeSuffixes].sort(), [...dependencyVolumeSuffixes].sort());
});

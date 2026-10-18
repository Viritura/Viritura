import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupManagedResources, selectCompilerCachesToEvict, type CompilerCache } from "./cleanup.ts";
import type { CommandResult, CommandRunner } from "./commandRunner.ts";
import { DockerClient } from "./docker.ts";
import { writeLease } from "./leases.ts";

function cache(index: number, protectedCache = false): CompilerCache {
  return { name: `cache-${index}`, project: `viritura-${index}`, lastUsedAt: index, protected: protectedCache };
}

test("compiler retention keeps exactly four newest environments", () => {
  assert.deepEqual(selectCompilerCachesToEvict([cache(1), cache(6), cache(3), cache(2), cache(4), cache(5)]), [
    cache(2),
    cache(1),
  ]);
  assert.deepEqual(selectCompilerCachesToEvict([cache(1), cache(2), cache(3), cache(4)]), []);
});

test("protected environments consume warm slots but are never evicted", () => {
  assert.deepEqual(selectCompilerCachesToEvict([cache(1, true), cache(2), cache(3), cache(4), cache(5)]), [cache(2)]);
  assert.deepEqual(
    selectCompilerCachesToEvict([
      cache(1, true),
      cache(2, true),
      cache(3, true),
      cache(4, true),
      cache(5, true),
      cache(6),
    ]),
    [cache(6)],
  );
});

class CacheRunner implements CommandRunner {
  readonly calls: string[][] = [];
  volumes = [
    "viritura-old-wasm-target",
    "viritura-new-wasm-target",
    "viritura-3-wasm-target",
    "viritura-4-wasm-target",
    "viritura-5-wasm-target",
  ];
  protectOld = false;
  failPrune = false;
  beforeEviction?: () => void;
  oldVolumeQueries = 0;

  async run(_executable: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([...args]);
    if (args[0] === "container" && args.includes(`volume=${this.volumes[0]}`)) {
      this.oldVolumeQueries += 1;
      if (this.oldVolumeQueries === 2) this.beforeEviction?.();
    }
    let stdout = "";
    if (args[0] === "volume" && args[1] === "ls" && args.includes("label=com.viritura.dev=worktree-wasm-target")) {
      stdout = this.volumes.join("\n");
    } else if (args[0] === "volume" && args[1] === "inspect") {
      const index = this.volumes.indexOf(args[2] ?? "");
      stdout = JSON.stringify([
        {
          CreatedAt: `2026-09-0${index + 1}T00:00:00Z`,
          Labels: { "com.viritura.dev.project": `viritura-project-${index}` },
        },
      ]);
    } else if (
      args[0] === "container" &&
      args[1] === "ls" &&
      this.protectOld &&
      (args.includes(`volume=${this.volumes[0]}`) || args.includes("label=com.docker.compose.project=viritura-running"))
    ) {
      stdout = "running-container";
    } else if (args[0] === "buildx" && this.failPrune) {
      throw new Error("Builder cache maintenance failed");
    }
    return { status: 0, stdout, stderr: "" };
  }
}

test("cleanup evicts only managed unused compiler output and enforces 20 GB", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-cache-budget-"));
  try {
    const runner = new CacheRunner();
    const docker = new DockerClient(runner, root, {});
    await cleanupManagedResources(docker, root);
    assert.deepEqual(
      runner.calls.filter((args) => args[0] === "volume" && args[1] === "rm"),
      [["volume", "rm", "viritura-old-wasm-target"]],
    );
    assert.ok(runner.calls.some((args) => args.join(" ") === "buildx prune --all --force --max-used-space 20GB"));
    assert.ok(runner.calls.some((args) => args.includes("label=com.viritura.dev.managed=true")));
    assert.ok(!runner.calls.some((args) => args.includes("system") || args.includes("viritura-dev-api-data")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("running stacks and referenced compiler volumes survive expired leases", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-running-budget-"));
  try {
    const leasePath = join(root, "leases", "viritura-running.json");
    const lease = {
      Project: "viritura-running",
      Slug: "running",
      Worktree: root,
      ExpiresAt: "2020-01-01T00:00:00Z",
      StoppedAt: "2020-01-02T00:00:00Z",
    };
    writeLease(leasePath, lease);
    const runner = new CacheRunner();
    runner.protectOld = true;
    await cleanupManagedResources(new DockerClient(runner, root, {}), root);
    assert.deepEqual(JSON.parse(readFileSync(leasePath, "utf8")), lease);
    assert.ok(!runner.calls.some((args) => args[0] === "container" && ["rm", "stop"].includes(args[1] ?? "")));
    assert.deepEqual(
      runner.calls.filter((args) => args[0] === "volume" && args[1] === "rm"),
      [["volume", "rm", "viritura-new-wasm-target"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("builder cache errors are surfaced rather than reporting successful maintenance", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-cache-error-"));
  try {
    const runner = new CacheRunner();
    runner.volumes = [];
    runner.failPrune = true;
    await assert.rejects(
      () => cleanupManagedResources(new DockerClient(runner, root, {}), root),
      /Builder cache maintenance failed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the project being prepared is protected even before a container references it", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-preparing-budget-"));
  try {
    const runner = new CacheRunner();
    await cleanupManagedResources(new DockerClient(runner, root, {}), root, new Date(), "viritura-project-0");
    assert.deepEqual(
      runner.calls.filter((args) => args[0] === "volume" && args[1] === "rm"),
      [["volume", "rm", "viritura-new-wasm-target"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a live lease protects a compiler environment without any container", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-live-build-"));
  try {
    writeLease(join(root, "leases", "viritura-project-0.json"), {
      Project: "viritura-project-0",
      Slug: "project-0",
      Worktree: root,
      ExpiresAt: "2026-10-18T16:00:00Z",
      StoppedAt: null,
    });
    const runner = new CacheRunner();
    await cleanupManagedResources(new DockerClient(runner, root, {}), root, new Date("2026-10-18T15:00:00Z"));
    assert.deepEqual(
      runner.calls.filter((args) => args[0] === "volume" && args[1] === "rm"),
      [["volume", "rm", "viritura-new-wasm-target"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("eviction rechecks the lease after a build renews it during cache selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-renewed-build-"));
  try {
    const runner = new CacheRunner();
    runner.beforeEviction = () =>
      writeLease(join(root, "leases", "viritura-project-0.json"), {
        Project: "viritura-project-0",
        Slug: "project-0",
        Worktree: root,
        ExpiresAt: "2026-10-18T16:00:00Z",
        StoppedAt: null,
      });
    await cleanupManagedResources(new DockerClient(runner, root, {}), root, new Date("2026-10-18T15:00:00Z"));
    assert.equal(runner.oldVolumeQueries, 2);
    assert.ok(!runner.calls.some((args) => args[0] === "volume" && args[1] === "rm"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired inactive stacks release their managed references after the grace period", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-expired-stack-"));
  try {
    const leasePath = join(root, "leases", "viritura-expired.json");
    writeLease(leasePath, {
      Project: "viritura-expired",
      Slug: "expired",
      Worktree: root,
      ExpiresAt: "2026-10-10T00:00:00Z",
      StoppedAt: "2026-10-11T00:00:00Z",
    });
    const calls: string[][] = [];
    const runner: CommandRunner = {
      async run(_executable, args) {
        calls.push([...args]);
        const managed = args.includes("label=com.viritura.dev.managed=true");
        const stdout =
          managed && args[1] === "ls" && args[0] === "container"
            ? "stopped-container"
            : managed &&
                args[1] === "ls" &&
                args[0] === "volume" &&
                args.includes("label=com.docker.compose.project=viritura-expired")
              ? "expired-api-obj"
              : "";
        return { status: 0, stdout, stderr: "" };
      },
    };
    await cleanupManagedResources(new DockerClient(runner, root, {}), root, new Date("2026-10-18T15:00:00Z"));
    assert.ok(calls.some((args) => args.join(" ") === "container rm --force stopped-container"));
    assert.ok(calls.some((args) => args.join(" ") === "volume rm expired-api-obj"));
    assert.equal(existsSync(leasePath), false);
    assert.ok(!calls.some((args) => args.includes("viritura-dev-api-data") || args[0] === "system"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale dependency cleanup removes all unused image tags but protects preparing and referenced resources", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-stale-dependencies-"));
  try {
    writeLease(join(root, "leases", "viritura-preparing.json"), {
      Project: "viritura-preparing",
      Slug: "preparing",
      Worktree: root,
      ExpiresAt: "2026-10-18T16:00:00Z",
      StoppedAt: null,
      NodeDependencyHash: "preparing",
      ApiImageTag: "api-preparing",
    });
    const calls: string[][] = [];
    const runner: CommandRunner = {
      async run(_executable, args) {
        calls.push([...args]);
        let stdout = "";
        if (
          args[0] === "volume" &&
          args[1] === "ls" &&
          args.includes("label=com.viritura.dev.cache=node-dependencies")
        ) {
          stdout = "viritura-dev-node-old-root\nviritura-dev-node-preparing-root\nviritura-dev-node-referenced-root";
        } else if (
          args[0] === "image" &&
          args[1] === "ls" &&
          args.includes("label=com.viritura.dev.cache=node-image")
        ) {
          stdout = "old-image\npreparing-image\nreferenced-image";
        } else if (args[0] === "image" && args[1] === "ls" && args.includes("label=com.viritura.dev.cache=api-image")) {
          stdout = "api-preparing-image";
        } else if (args[1] === "inspect") {
          if (args.includes("--format")) {
            stdout = JSON.stringify(
              args[2] === "old-image"
                ? ["viritura-dev-worktree:old-a", "viritura-dev-worktree:old-b"]
                : args[2] === "api-preparing-image"
                  ? ["viritura-api-dev:api-preparing"]
                  : ["viritura-dev-worktree:preparing"],
            );
          } else {
            stdout = JSON.stringify([{ CreatedAt: "2026-09-01T00:00:00Z", Created: "2026-09-01T00:00:00Z" }]);
          }
        } else if (
          args[0] === "container" &&
          args.some((arg) => arg === "volume=viritura-dev-node-referenced-root" || arg === "ancestor=referenced-image")
        ) {
          stdout = "protected-container";
        }
        return { status: 0, stdout, stderr: "" };
      },
    };
    await cleanupManagedResources(new DockerClient(runner, root, {}), root, new Date("2026-10-18T15:00:00Z"));
    assert.deepEqual(
      calls.filter((args) => args[0] === "image" && args[1] === "rm"),
      [
        ["image", "rm", "viritura-dev-worktree:old-a"],
        ["image", "rm", "viritura-dev-worktree:old-b"],
      ],
    );
    assert.deepEqual(
      calls.filter((args) => args[0] === "volume" && args[1] === "rm"),
      [["volume", "rm", "viritura-dev-node-old-root"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

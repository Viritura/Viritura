import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  async run(_executable: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([...args]);
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

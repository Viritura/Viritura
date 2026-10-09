import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { SystemCommandRunner, type CommandRunner } from "./commandRunner.ts";
import { DockerClient } from "./docker.ts";
import { isDisposableIgnoredPath, retireWorktree } from "./retirement.ts";
import { writeLease } from "./leases.ts";
import { deriveSlug } from "./config.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "viritura-retirement-"));
  const primary = join(root, "primary");
  const linked = join(root, "linked");
  const state = join(root, "state");
  mkdirSync(primary);
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  const git = (args: string[], cwd = primary) => {
    const result = spawnSync("git", args, { cwd, env: environment, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "Retirement Test"]);
  writeFileSync(join(primary, "source.txt"), "preserved source\n");
  writeFileSync(join(primary, ".gitignore"), "node_modules/\n.turbo/\nengine/target/\n.secrets/\n");
  git(["add", "."]);
  git(["commit", "-m", "fixture"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["worktree", "add", "-b", "feature", linked]);
  const calls: string[][] = [];
  const dockerRunner: CommandRunner = {
    async run(_executable, args) {
      calls.push([...args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  const systemRunner = new SystemCommandRunner();
  const isolatedRunner: CommandRunner = {
    run(executable, args, options = {}) {
      return systemRunner.run(executable, args, { ...options, env: environment });
    },
  };
  const retire = (target = linked) =>
    retireWorktree(isolatedRunner, new DockerClient(dockerRunner, primary, {}), primary, state, target);
  return { root, primary, linked, state, calls, git, retire };
}

test("retirement recognizes only explicitly disposable ignored directories", () => {
  assert.equal(isDisposableIgnoredPath("packages/core/node_modules/"), true);
  assert.equal(isDisposableIgnoredPath("engine\\target\\"), true);
  assert.equal(isDisposableIgnoredPath("apps/desktop/src-tauri/target/"), true);
  assert.equal(isDisposableIgnoredPath(".secrets/"), false);
  assert.equal(isDisposableIgnoredPath("notes/target/"), false);
  assert.equal(isDisposableIgnoredPath("dist/"), false);
});

test("retirement also removes managed stacks leased under earlier branch names", async () => {
  const f = fixture();
  try {
    const leaseFile = join(f.state, "leases", "viritura-previous-branch.json");
    writeLease(leaseFile, {
      Project: "viritura-previous-branch",
      Slug: "previous-branch",
      Worktree: f.linked,
      ExpiresAt: "2020-01-01T00:00:00Z",
      StoppedAt: null,
    });
    await f.retire();
    assert.equal(existsSync(leaseFile), false);
    assert.ok(f.calls.some((args) => args.includes("label=com.docker.compose.project=viritura-previous-branch")));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("retirement removes a clean published worktree through Git without force", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.linked, "node_modules"));
    writeFileSync(join(f.linked, "node_modules", "rebuildable.txt"), "cache");
    await f.retire();
    assert.equal(existsSync(f.linked), false);
    assert.equal(existsSync(join(f.primary, "source.txt")), true);
    f.git(["show-ref", "--verify", "refs/heads/feature"]);
    assert.ok(f.calls.every((args) => args.includes("label=com.viritura.dev.managed=true")));
    const project = `viritura-${deriveSlug(f.linked.replaceAll("\\", "/"), "feature")}`;
    assert.ok(f.calls.some((args) => args.includes(`label=com.docker.compose.project=${project}`)));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const kind of ["dirty", "untracked", "ignored", "unpushed", "locked", "primary"] as const) {
  test(`retirement protects ${kind} work without changing Docker resources`, async () => {
    const f = fixture();
    try {
      if (kind === "dirty") writeFileSync(join(f.linked, "source.txt"), "unsaved change");
      if (kind === "untracked") writeFileSync(join(f.linked, "notes.txt"), "untracked work");
      if (kind === "ignored") {
        mkdirSync(join(f.linked, ".secrets"));
        writeFileSync(join(f.linked, ".secrets", "fixture.txt"), "must preserve");
      }
      if (kind === "unpushed") {
        writeFileSync(join(f.linked, "source.txt"), "local commit");
        f.git(["add", "."], f.linked);
        f.git(["commit", "-m", "not published"], f.linked);
      }
      if (kind === "locked") f.git(["worktree", "lock", f.linked]);
      await assert.rejects(() => f.retire(kind === "primary" ? f.primary : f.linked));
      assert.equal(existsSync(f.linked), true);
      assert.equal(f.calls.length, 0);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

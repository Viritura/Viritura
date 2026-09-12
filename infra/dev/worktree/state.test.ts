import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getContentTag } from "./contentHash.ts";
import { withFileLock } from "./fileLock.ts";
import { getCleanupAction, writeLease, type WorktreeLease } from "./leases.ts";

test("content tags are order-independent and include file paths and bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-hash-"));
  try {
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    writeFileSync(first, "alpha");
    writeFileSync(second, "beta");
    assert.equal(getContentTag(root, [first, second]), getContentTag(root, [second, first, first]));
    assert.notEqual(getContentTag(root, [first]), getContentTag(root, [second]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file locks serialize concurrent work", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-lock-"));
  const lock = join(root, "test.lock");
  const events: string[] = [];
  try {
    const first = withFileLock(lock, 2_000, async () => {
      events.push("first-start");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      events.push("first-end");
    });
    const second = withFileLock(lock, 2_000, async () => {
      events.push("second");
    });
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first-start", "first-end", "second"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file locks recover an abandoned owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-stale-lock-"));
  const lock = join(root, "test.lock");
  try {
    writeFileSync(lock, JSON.stringify({ pid: 2_147_483_647, createdAt: "2020-01-01T00:00:00.000Z" }));
    let ran = false;
    await withFileLock(lock, 2_000, async () => {
      ran = true;
    });
    assert.equal(ran, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lease cleanup stops expired stacks before removing them after the grace period", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");
  const lease: WorktreeLease = {
    Project: "viritura-feature-abcd",
    Slug: "feature-abcd",
    Worktree: "/work/feature",
    ExpiresAt: "2026-09-11T11:00:00.000Z",
    StoppedAt: null,
  };
  assert.equal(getCleanupAction(lease, now, 86_400_000), "stop");
  assert.equal(getCleanupAction({ ...lease, StoppedAt: "2026-09-10T11:59:59.000Z" }, now, 86_400_000), "remove");
  assert.equal(getCleanupAction({ ...lease, ExpiresAt: "2026-09-11T13:00:00.000Z" }, now, 86_400_000), "none");
});

test("lease files retain the existing JSON contract", () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-lease-"));
  const path = join(root, "lease.json");
  try {
    writeLease(path, {
      Project: "viritura-test-abcd",
      Slug: "test-abcd",
      Worktree: "/work/test",
      ExpiresAt: "2026-09-11T12:00:00.000Z",
      StoppedAt: null,
    });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path, "utf8"))), [
      "Project",
      "Slug",
      "Worktree",
      "ExpiresAt",
      "StoppedAt",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lease parsing accepts UTF-8 BOM files created by Windows PowerShell", async () => {
  const root = mkdtempSync(join(tmpdir(), "viritura-bom-lease-"));
  const path = join(root, "lease.json");
  try {
    writeFileSync(
      path,
      `\uFEFF${JSON.stringify({
        Project: "viritura-test-abcd",
        Slug: "test-abcd",
        Worktree: "C:\\work\\test",
        ExpiresAt: "2026-09-11T12:00:00.000Z",
        StoppedAt: null,
      })}`,
    );
    const { readLease } = await import("./leases.ts");
    assert.equal(readLease(path).Project, "viritura-test-abcd");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

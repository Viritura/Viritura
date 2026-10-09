import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { removeProjectResources } from "./cleanup.ts";
import type { CommandRunner } from "./commandRunner.ts";
import { deriveSlug } from "./config.ts";
import type { DockerClient } from "./docker.ts";
import { readLease, removeLease, withLeaseLock } from "./leases.ts";

export function isDisposableIgnoredPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    /(^|\/)(node_modules|\.turbo)(\/|$)/.test(normalized) ||
    /^(engine|apps\/desktop\/src-tauri)\/target(\/|$)/.test(normalized)
  );
}

export async function retireWorktree(
  runner: CommandRunner,
  docker: DockerClient,
  primaryRoot: string,
  stateRoot: string,
  target: string,
): Promise<void> {
  const path = resolve(target);
  const git = async (args: readonly string[], cwd = primaryRoot) =>
    (await runner.run("git", args, { capture: true, cwd })).stdout.trim();
  const registrations = (await git(["worktree", "list", "--porcelain"])).split(/\r?\n\r?\n/);
  const registration = registrations.find((entry) => {
    const firstLine = entry.split(/\r?\n/)[0];
    return firstLine?.startsWith("worktree ") && resolve(firstLine.slice(9)) === path;
  });
  if (!registration || path === resolve(primaryRoot) || path === resolve(process.cwd())) {
    throw new Error("Retire requires a registered linked worktree other than the primary/current checkout.");
  }
  if (/^locked(?: |$)/m.test(registration) || /^prunable(?: |$)/m.test(registration)) {
    throw new Error("Refusing to retire a locked or missing worktree.");
  }
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], path);
  const repositoryRoot = await git(["rev-parse", "--show-toplevel"], path);
  if (resolve(repositoryRoot) !== path) throw new Error("Retirement target is not the registered repository root.");
  const project = `viritura-${deriveSlug(repositoryRoot, branch)}`;
  await withLeaseLock(join(stateRoot, "locks"), project, async () => {
    if (await git(["status", "--porcelain=v1", "--untracked-files=all"], path)) {
      throw new Error("Worktree has uncommitted or untracked files; commit/push or preserve them before retirement.");
    }
    if (await git(["rev-list", "HEAD", "--not", "--remotes"], path)) {
      throw new Error("Worktree has commits not present in remote-tracking refs; push them before retirement.");
    }
    const ignored = await git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], path);
    const protectedPaths = ignored.split("\0").filter((entry) => entry && !isDisposableIgnoredPath(entry));
    if (protectedPaths.length > 0) {
      throw new Error(
        `Worktree contains ignored files outside disposable caches; preserve them first:\n${protectedPaths.join("\n")}`,
      );
    }
    const leaseFile = join(stateRoot, "leases", `${project}.json`);
    if (existsSync(leaseFile) && resolve(readLease(leaseFile).Worktree) !== path) {
      throw new Error("Worktree lease ownership does not match the retirement target.");
    }
    const leaseDirectory = join(stateRoot, "leases");
    const projects = new Set([project]);
    if (existsSync(leaseDirectory)) {
      for (const name of readdirSync(leaseDirectory).filter((entry) => entry.endsWith(".json"))) {
        const lease = readLease(join(leaseDirectory, name));
        if (resolve(lease.Worktree) !== path) continue;
        if (lease.Project !== basename(name, ".json")) throw new Error(`Invalid lease ownership: '${name}'.`);
        projects.add(lease.Project);
      }
    }
    for (const ownedProject of projects) {
      if (ownedProject === project) {
        await removeProjectResources(docker, ownedProject);
      } else {
        await withLeaseLock(join(stateRoot, "locks"), ownedProject, () => removeProjectResources(docker, ownedProject));
      }
    }
    // Git performs its own final dirty/locked checks; never force source removal.
    await runner.run("git", ["worktree", "remove", "--", path], { cwd: primaryRoot });
    if (existsSync(path)) throw new Error(`Git left residual worktree files at '${path}'; inspect them manually.`);
    for (const ownedProject of projects) removeLease(join(leaseDirectory, `${ownedProject}.json`));
    console.log(`Retired '${path}'; the branch, shared dependencies, and database are preserved.`);
  });
}

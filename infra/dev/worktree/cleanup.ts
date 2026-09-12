import { mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DockerClient } from "./docker.ts";
import { getCleanupAction, readLease, removeLease, withLeaseLock, writeLease } from "./leases.ts";

const removalGraceMilliseconds = 24 * 60 * 60 * 1_000;
const cacheRetentionMilliseconds = 7 * 24 * 60 * 60 * 1_000;

async function removeProjectResources(docker: DockerClient, project: string): Promise<void> {
  const managedFilter = ["--filter", "label=com.viritura.dev.managed=true"];
  const projectFilter = ["--filter", `label=com.docker.compose.project=${project}`];
  const containers = await docker.ids(["container", "ls", "--all", "--quiet", ...projectFilter, ...managedFilter]);
  if (containers.length > 0) await docker.run(["container", "rm", "--force", ...containers]);

  const networks = await docker.ids(["network", "ls", "--quiet", ...projectFilter, ...managedFilter]);
  for (const network of networks) await docker.run(["network", "rm", network]);

  const composeVolumes = await docker.ids(["volume", "ls", "--quiet", ...projectFilter, ...managedFilter]);
  for (const volume of composeVolumes) await docker.run(["volume", "rm", volume]);

  const worktreeVolumes = await docker.ids([
    "volume",
    "ls",
    "--quiet",
    "--filter",
    `label=com.viritura.dev.project=${project}`,
    ...managedFilter,
  ]);
  for (const volume of worktreeVolumes) await docker.run(["volume", "rm", volume]);
}

async function inspectCreatedAt(
  docker: DockerClient,
  resource: "image" | "volume",
  id: string,
): Promise<number | undefined> {
  const result = await docker.run([resource, "inspect", id], { allowFailure: true, capture: true });
  if (result.status !== 0) return undefined;
  const inspection = (JSON.parse(result.stdout) as Array<{ Created?: string; CreatedAt?: string }>)[0];
  const created = inspection?.Created ?? inspection?.CreatedAt;
  return created ? Date.parse(created) : undefined;
}

async function removeStaleCaches(docker: DockerClient, now: Date): Promise<void> {
  const cutoff = now.getTime() - cacheRetentionMilliseconds;
  const volumes = await docker.ids([
    "volume",
    "ls",
    "--quiet",
    "--filter",
    "label=com.viritura.dev.cache=node-dependencies",
  ]);
  for (const volume of volumes) {
    const createdAt = await inspectCreatedAt(docker, "volume", volume);
    if (createdAt === undefined || createdAt > cutoff) continue;
    const users = await docker.ids(["container", "ls", "--all", "--quiet", "--filter", `volume=${volume}`]);
    if (users.length === 0) await docker.run(["volume", "rm", volume]);
  }

  for (const cacheLabel of ["node-image", "api-image"]) {
    const images = new Set(
      await docker.ids(["image", "ls", "--quiet", "--filter", `label=com.viritura.dev.cache=${cacheLabel}`]),
    );
    for (const image of images) {
      const createdAt = await inspectCreatedAt(docker, "image", image);
      if (createdAt === undefined || createdAt > cutoff) continue;
      const users = await docker.ids(["container", "ls", "--all", "--quiet", "--filter", `ancestor=${image}`]);
      if (users.length === 0) await docker.run(["image", "rm", image]);
    }
  }
}

export async function cleanupManagedResources(
  docker: DockerClient,
  stateRoot: string,
  now = new Date(),
): Promise<void> {
  if (!(await docker.isAvailable())) {
    console.warn("Docker is not available; skipping Viritura worktree cleanup.");
    return;
  }
  const leaseDirectory = join(stateRoot, "leases");
  const lockDirectory = join(stateRoot, "locks");
  mkdirSync(leaseDirectory, { recursive: true });
  const leaseFiles = readdirSync(leaseDirectory)
    .map((name) => join(leaseDirectory, name))
    .filter((path) => path.endsWith(".json") && statSync(path).isFile());

  for (const leaseFile of leaseFiles) {
    const expectedProject = basename(leaseFile, ".json");
    try {
      await withLeaseLock(lockDirectory, expectedProject, async () => {
        const lease = readLease(leaseFile);
        if (lease.Project !== expectedProject) {
          throw new Error(`Lease project '${lease.Project}' does not match its file name.`);
        }
        const action = getCleanupAction(lease, now, removalGraceMilliseconds);
        if (action === "stop") {
          const containers = await docker.ids([
            "container",
            "ls",
            "--quiet",
            "--filter",
            `label=com.docker.compose.project=${lease.Project}`,
            "--filter",
            "label=com.viritura.dev.managed=true",
          ]);
          if (containers.length > 0) {
            console.log(`Stopping expired development stack '${lease.Project}'...`);
            await docker.run(["container", "stop", ...containers]);
          }
          writeLease(leaseFile, { ...lease, StoppedAt: now.toISOString() });
        } else if (action === "remove") {
          console.log(`Removing expired development stack '${lease.Project}'...`);
          await removeProjectResources(docker, lease.Project);
          removeLease(leaseFile);
        }
      });
    } catch (error) {
      console.warn(`Unable to process lease '${leaseFile}': ${(error as Error).message}`);
    }
  }
  await removeStaleCaches(docker, now);
}

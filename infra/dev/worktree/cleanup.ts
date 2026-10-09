import { mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DockerClient } from "./docker.ts";
import { getCleanupAction, readLease, removeLease, withLeaseLock, writeLease } from "./leases.ts";

const removalGraceMilliseconds = 24 * 60 * 60 * 1_000;
const cacheRetentionMilliseconds = 7 * 24 * 60 * 60 * 1_000;

export async function removeProjectResources(docker: DockerClient, project: string): Promise<void> {
  if (!project.startsWith("viritura-") || project === "viritura-dev-proxy") {
    throw new Error(`Refusing to remove unmanaged project '${project}'.`);
  }
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
  protectedProject?: string,
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
        if (lease.Project === protectedProject) return;
        const running = await docker.ids([
          "container",
          "ls",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${lease.Project}`,
        ]);
        if (running.length > 0) return;
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
  await retainWarmCompilerCaches(docker, stateRoot, protectedProject);
  console.log("Enforcing the selected Docker builder's 20 GB cache target...");
  await docker.run(["buildx", "prune", "--all", "--force", "--max-used-space", "20GB"], { capture: true });
}

export interface CompilerCache {
  readonly name: string;
  readonly project: string;
  readonly lastUsedAt: number;
  readonly protected: boolean;
}

export function selectCompilerCachesToEvict(caches: readonly CompilerCache[]): CompilerCache[] {
  const protectedCount = caches.filter((cache) => cache.protected).length;
  const available = caches
    .filter((cache) => !cache.protected)
    .sort((first, second) => second.lastUsedAt - first.lastUsedAt || first.name.localeCompare(second.name));
  return available.slice(Math.max(0, 4 - protectedCount));
}

async function retainWarmCompilerCaches(
  docker: DockerClient,
  stateRoot: string,
  protectedProject?: string,
): Promise<void> {
  const names = await docker.ids([
    "volume",
    "ls",
    "--quiet",
    "--filter",
    "label=com.viritura.dev=worktree-wasm-target",
    "--filter",
    "label=com.viritura.dev.managed=true",
  ]);
  const caches: CompilerCache[] = [];
  for (const name of names) {
    const [inspection] = JSON.parse(await docker.output(["volume", "inspect", name])) as Array<{
      CreatedAt: string;
      Labels: Record<string, string>;
    }>;
    if (!inspection) throw new Error(`Missing compiler volume inspection: '${name}'.`);
    const project = inspection.Labels["com.viritura.dev.project"];
    if (!project?.startsWith("viritura-")) throw new Error(`Invalid compiler volume ownership: '${name}'.`);
    const leasePath = join(stateRoot, "leases", `${project}.json`);
    let lastUsedAt = Date.parse(inspection.CreatedAt);
    try {
      lastUsedAt = Date.parse(readLease(leasePath).ExpiresAt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!Number.isFinite(lastUsedAt)) throw new Error(`Invalid compiler cache timestamp: '${name}'.`);
    const users = await docker.ids(["container", "ls", "--all", "--quiet", "--filter", `volume=${name}`]);
    caches.push({ name, project, lastUsedAt, protected: project === protectedProject || users.length > 0 });
  }
  for (const cache of selectCompilerCachesToEvict(caches)) {
    await withLeaseLock(join(stateRoot, "locks"), cache.project, async () => {
      const users = await docker.ids(["container", "ls", "--all", "--quiet", "--filter", `volume=${cache.name}`]);
      if (users.length > 0) return;
      console.log(`Evicting unused compiler cache '${cache.name}' (keeping four warm environments)...`);
      await docker.run(["volume", "rm", cache.name]);
    });
  }
  if (caches.filter((cache) => cache.protected).length > 4) {
    console.warn("More than four compiler environments are in use; referenced caches will not be evicted.");
  }
}

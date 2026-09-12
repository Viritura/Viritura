import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupManagedResources } from "./cleanup.ts";
import type { CommandRunner } from "./commandRunner.ts";
import { deriveSlug, getProfiles, getStateRoot, needsWasm, type WorktreeCommand } from "./config.ts";
import { getApiRestoreInputs, getContentTag, getNodeDependencyInputs } from "./contentHash.ts";
import { DockerClient } from "./docker.ts";
import { withFileLock } from "./fileLock.ts";
import { readLease, removeLease, withLeaseLock, writeLease, type WorktreeLease } from "./leases.ts";

const leaseDurationMilliseconds = 8 * 60 * 60 * 1_000;
const wasmImage = "viritura-wasm-dev:rust-1.93.1-wasm-pack-0.14.0";
const dependencyVolumeSuffixes = [
  "root",
  "package-audio",
  "package-core",
  "package-crdt",
  "app-editor",
  "package-format",
  "package-instrument-profiles",
  "package-midi",
  "package-monaco-react",
  "package-musicxml",
  "package-piano-roll",
  "package-playback",
  "package-renderer",
  "package-score-engine",
  "package-score-viewer-react",
  "package-sound-profiles",
  "package-ui",
  "package-video-sync",
  "example-score-viewer",
  "app-desktop",
  "app-server-ui",
  "app-vscode-viewer",
  "app-website",
] as const;

const sharedBuildVolumes = [
  "viritura-dev-cargo-registry",
  "viritura-dev-cargo-git",
  "viritura-dev-wasm-pack-cache",
  "viritura-dev-nuget-packages",
] as const;

interface StackContext {
  readonly repositoryRoot: string;
  readonly proxyCompose: string;
  readonly worktreeCompose: string;
  readonly stateRoot: string;
  readonly lockDirectory: string;
  readonly leaseFile: string;
  readonly slug: string;
  readonly project: string;
  readonly dependencyHash: string;
  readonly nodeImage: string;
  readonly dependencyVolumes: readonly string[];
  readonly wasmTargetVolume: string;
  readonly env: NodeJS.ProcessEnv;
}

async function gitOutput(runner: CommandRunner, args: readonly string[], cwd: string): Promise<string> {
  return (await runner.run("git", args, { capture: true, cwd })).stdout.trim();
}

async function createContext(runner: CommandRunner): Promise<StackContext> {
  const cwd = process.cwd();
  const repositoryRoot = await gitOutput(runner, ["rev-parse", "--show-toplevel"], cwd);
  const branch = await gitOutput(runner, ["rev-parse", "--abbrev-ref", "HEAD"], repositoryRoot);
  const slug = deriveSlug(repositoryRoot, branch);
  const project = `viritura-${slug}`;
  const stateRoot = getStateRoot(process.platform, process.env, homedir());
  const dependencyHash = getContentTag(repositoryRoot, getNodeDependencyInputs(repositoryRoot));
  const apiRestoreHash = getContentTag(repositoryRoot, getApiRestoreInputs(repositoryRoot));
  const apiConfigDirectory = join(stateRoot, slug);
  mkdirSync(apiConfigDirectory, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    VIRITURA_SLUG: slug,
    VIRITURA_API_ENV_FILE: join(apiConfigDirectory, "api.env"),
    VIRITURA_DEPENDENCY_HASH: dependencyHash,
    VIRITURA_NODE_IMAGE_TAG: dependencyHash,
    VIRITURA_API_IMAGE_TAG: apiRestoreHash,
  };
  const scriptDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return {
    repositoryRoot,
    proxyCompose: join(scriptDirectory, "proxy", "docker-compose.yml"),
    worktreeCompose: join(scriptDirectory, "worktree", "docker-compose.yml"),
    stateRoot,
    lockDirectory: join(stateRoot, "locks"),
    leaseFile: join(stateRoot, "leases", `${project}.json`),
    slug,
    project,
    dependencyHash,
    nodeImage: `viritura-dev-worktree:${dependencyHash}`,
    dependencyVolumes: dependencyVolumeSuffixes.map((suffix) => `viritura-dev-node-${dependencyHash}-${suffix}`),
    wasmTargetVolume: `${project}-wasm-target`,
    env,
  };
}

async function ensureExternalVolume(
  docker: DockerClient,
  name: string,
  label: string,
  options: { project?: string; cache?: string; contentHash?: string } = {},
): Promise<void> {
  if (await docker.succeeds(["volume", "inspect", name])) return;
  console.log(`Creating isolated volume '${name}'...`);
  const labels = ["--label", `com.viritura.dev=${label}`];
  if (options.project)
    labels.push("--label", `com.viritura.dev.project=${options.project}`, "--label", "com.viritura.dev.managed=true");
  if (options.cache) labels.push("--label", `com.viritura.dev.cache=${options.cache}`);
  if (options.contentHash) labels.push("--label", `com.viritura.dev.hash=${options.contentHash}`);
  await docker.run(["volume", "create", ...labels, name], { capture: true });
}

async function removeExternalVolume(docker: DockerClient, name: string): Promise<void> {
  if (await docker.succeeds(["volume", "inspect", name])) await docker.run(["volume", "rm", name], { capture: true });
}

async function ensureProxy(docker: DockerClient, context: StackContext): Promise<void> {
  await docker.compose(["-f", context.proxyCompose, "up", "-d"]);
}

async function ensureSharedBuildCaches(docker: DockerClient): Promise<void> {
  for (const volume of sharedBuildVolumes) await ensureExternalVolume(docker, volume, "shared-build-cache");
}

async function initializeNodeDependencies(docker: DockerClient, context: StackContext): Promise<void> {
  await withFileLock(join(context.lockDirectory, `dependencies-${context.dependencyHash}.lock`), 600_000, async () => {
    if (!(await docker.succeeds(["image", "inspect", context.nodeImage]))) {
      console.log(`Building worktree Node image '${context.nodeImage}'...`);
      await docker.compose(["-f", context.worktreeCompose, "--profile", "images", "build", "node-image"]);
    }
    for (const volume of context.dependencyVolumes) {
      await ensureExternalVolume(docker, volume, `node-dependencies-${context.dependencyHash}`, {
        cache: "node-dependencies",
        contentHash: context.dependencyHash,
      });
    }
    await docker.compose(["-f", context.worktreeCompose, "--profile", "images", "run", "--rm", "dependency-seed"]);
  });
}

async function invokeWasmBuild(docker: DockerClient, context: StackContext): Promise<void> {
  if (!(await docker.succeeds(["image", "inspect", wasmImage]))) {
    console.log(`Building shared WASM tool image '${wasmImage}'...`);
    await docker.compose(["-f", context.worktreeCompose, "--profile", "build", "build", "wasm-build"]);
  }
  await docker.compose(["-f", context.worktreeCompose, "--profile", "build", "run", "--rm", "wasm-build"]);
}

function activeLease(context: StackContext): WorktreeLease {
  return {
    Project: context.project,
    Slug: context.slug,
    Worktree: context.repositoryRoot,
    ExpiresAt: new Date(Date.now() + leaseDurationMilliseconds).toISOString(),
    StoppedAt: null,
  };
}

async function renewLease(context: StackContext): Promise<void> {
  await withLeaseLock(context.lockDirectory, context.project, async () => {
    const lease = activeLease(context);
    writeLease(context.leaseFile, lease);
    console.log(`Lease renewed through ${new Date(lease.ExpiresAt).toLocaleString()}.`);
  });
}

async function markLeaseStopped(context: StackContext): Promise<void> {
  await withLeaseLock(context.lockDirectory, context.project, async () => {
    const now = new Date().toISOString();
    const lease = existsSync(context.leaseFile)
      ? readLease(context.leaseFile)
      : { ...activeLease(context), ExpiresAt: now };
    writeLease(context.leaseFile, { ...lease, ExpiresAt: now, StoppedAt: now });
  });
}

async function composeWithLease(docker: DockerClient, context: StackContext, args: readonly string[]): Promise<void> {
  await cleanupManagedResources(docker, context.stateRoot);
  await withLeaseLock(context.lockDirectory, context.project, async () => {
    const lease = activeLease(context);
    writeLease(context.leaseFile, lease);
    console.log(`Lease renewed through ${new Date(lease.ExpiresAt).toLocaleString()}.`);
    try {
      await docker.compose(args);
    } catch (error) {
      const now = new Date().toISOString();
      writeLease(context.leaseFile, { ...lease, ExpiresAt: now, StoppedAt: now });
      throw error;
    }
  });
}

function profileArgs(targets: readonly string[]): string[] {
  return getProfiles(targets).flatMap((profile) => ["--profile", profile]);
}

function showUrls(context: StackContext): void {
  console.log(`\nWorktree slug: ${context.slug}`);
  console.log(`  Editor       http://editor.${context.slug}.localhost`);
  console.log(`  API          http://api.${context.slug}.localhost`);
  console.log(`  Website      http://web.${context.slug}.localhost`);
  console.log(`  UI stories   http://ui.${context.slug}.localhost`);
  console.log(`  MNX stories  http://mnx.${context.slug}.localhost`);
  console.log(`  App stories  http://storybook.${context.slug}.localhost`);
  console.log("  Traefik      http://traefik.localhost  (dashboard http://127.0.0.1:8080)");
  console.log("\n  Container API URL: http://api:8080");
  console.log(`  API secrets file: ${context.env.VIRITURA_API_ENV_FILE}\n`);
}

async function prepareStack(docker: DockerClient, context: StackContext, targets: readonly string[]): Promise<void> {
  await ensureProxy(docker, context);
  await ensureExternalVolume(docker, "viritura-dev-api-data", "shared-api-data");
  await ensureSharedBuildCaches(docker);
  await initializeNodeDependencies(docker, context);
  if (needsWasm(targets)) {
    await ensureExternalVolume(docker, context.wasmTargetVolume, "worktree-wasm-target", { project: context.project });
    await invokeWasmBuild(docker, context);
  }
}

export async function runStackCommand(
  command: WorktreeCommand,
  targets: readonly string[],
  runner: CommandRunner,
): Promise<void> {
  const context = await createContext(runner);
  if (command === "slug") {
    console.log(context.slug);
    return;
  }
  if (command === "url") {
    showUrls(context);
    return;
  }
  if (command === "keepalive") {
    await renewLease(context);
    return;
  }

  const docker = new DockerClient(runner, context.repositoryRoot, context.env);
  await docker.requireEngine();
  const composeBase = ["-f", context.worktreeCompose];

  switch (command) {
    case "cleanup":
      await cleanupManagedResources(docker, context.stateRoot);
      break;
    case "proxy":
      await ensureProxy(docker, context);
      console.log("Traefik proxy is up: http://traefik.localhost (dashboard http://127.0.0.1:8080)");
      break;
    case "proxy-down":
      await docker.compose(["-f", context.proxyCompose, "down"]);
      break;
    case "up":
      await prepareStack(docker, context, targets);
      console.log(`Starting '${context.project}'...`);
      await composeWithLease(docker, context, [...composeBase, ...profileArgs(targets), "up", "-d"]);
      showUrls(context);
      break;
    case "watch":
      await prepareStack(docker, context, targets);
      if (!needsWasm(targets)) {
        await ensureExternalVolume(docker, context.wasmTargetVolume, "worktree-wasm-target", {
          project: context.project,
        });
        await invokeWasmBuild(docker, context);
      }
      console.log(`Starting '${context.project}' with UI, Rust/WASM, and API hot reload...`);
      await composeWithLease(docker, context, [
        ...composeBase,
        ...profileArgs(targets),
        "--profile",
        "watch",
        "up",
        "-d",
      ]);
      showUrls(context);
      break;
    case "restart":
      await composeWithLease(docker, context, [...composeBase, ...profileArgs(targets), "restart"]);
      break;
    case "rebuild":
      await ensureProxy(docker, context);
      await ensureExternalVolume(docker, "viritura-dev-api-data", "shared-api-data");
      await ensureSharedBuildCaches(docker);
      console.log(`Rebuilding '${context.project}' from scratch (shared package caches are preserved)...`);
      await docker.compose([...composeBase, "--profile", "*", "down", "-v"]);
      await docker.compose([...composeBase, "--profile", "images", "build", "node-image"]);
      await initializeNodeDependencies(docker, context);
      if (needsWasm(targets)) {
        await ensureExternalVolume(docker, context.wasmTargetVolume, "worktree-wasm-target", {
          project: context.project,
        });
        await invokeWasmBuild(docker, context);
      }
      await composeWithLease(docker, context, [...composeBase, ...profileArgs(targets), "up", "-d", "--build"]);
      showUrls(context);
      break;
    case "stop":
      await docker.compose([...composeBase, "--profile", "*", "stop"]);
      await markLeaseStopped(context);
      break;
    case "down":
      console.log(`Removing '${context.project}' containers and networks (worktree compiler output is preserved)...`);
      await docker.compose([...composeBase, "--profile", "*", "down", "--remove-orphans"]);
      await markLeaseStopped(context);
      break;
    case "prune":
      console.log(
        `Removing '${context.project}' containers, networks, and compiler output (shared dependencies and API data are preserved)...`,
      );
      await docker.compose([...composeBase, "--profile", "*", "down", "-v"]);
      await removeExternalVolume(docker, context.wasmTargetVolume);
      await withLeaseLock(context.lockDirectory, context.project, async () => removeLease(context.leaseFile));
      break;
    case "status":
      await docker.compose([...composeBase, "--profile", "*", "ps"]);
      showUrls(context);
      break;
    case "logs":
      await docker.compose([...composeBase, "--profile", "*", "logs", "-f", "--tail=200", ...targets.slice(0, 1)]);
      break;
    case "wasm":
      await ensureSharedBuildCaches(docker);
      await ensureExternalVolume(docker, context.wasmTargetVolume, "worktree-wasm-target", {
        project: context.project,
      });
      await invokeWasmBuild(docker, context);
      break;
  }
}

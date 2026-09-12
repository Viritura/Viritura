import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export function getContentTag(repositoryRoot: string, paths: readonly string[]): string {
  const root = resolve(repositoryRoot);
  const hash = createHash("sha256");
  for (const path of [...new Set(paths.map((entry) => resolve(entry)))].sort()) {
    const relativePath = relative(root, path);
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error(`Hash input is outside the repository: ${path}`);
    }
    hash.update(relativePath.split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function packageManifests(repositoryRoot: string, directory: string): string[] {
  const root = resolve(repositoryRoot, directory);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name, "package.json"))
    .filter((path) => {
      try {
        readFileSync(path);
        return true;
      } catch {
        return false;
      }
    });
}

export function getNodeDependencyInputs(repositoryRoot: string): string[] {
  return [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    ".dockerignore",
    "infra/dev/worktree/dev.Dockerfile",
  ]
    .map((path) => resolve(repositoryRoot, path))
    .concat(packageManifests(repositoryRoot, "apps"))
    .concat(packageManifests(repositoryRoot, "packages"))
    .concat(packageManifests(repositoryRoot, "examples"));
}

export function getApiRestoreInputs(repositoryRoot: string): string[] {
  return [
    ".dockerignore",
    "infra/dev/worktree/api.Dockerfile",
    "server/Directory.Build.props",
    "server/Viritura.Api/Viritura.Api.csproj",
    "server/Viritura.Api/packages.lock.json",
    "server/Viritura.GitHub/Viritura.GitHub.csproj",
    "server/Viritura.GitHub/packages.lock.json",
    "server/Viritura.Infrastructure/Viritura.Infrastructure.csproj",
    "server/Viritura.Infrastructure/packages.lock.json",
  ].map((path) => resolve(repositoryRoot, path));
}

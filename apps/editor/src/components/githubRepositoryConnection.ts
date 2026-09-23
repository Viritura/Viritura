import type { RemoteCompatibility } from "../git/ProjectAdapter";

const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export type RepositoryVisibility = "private" | "public";
export type RepositoryWizardStep = "choose" | "create" | "waiting" | "link" | "checking" | "result" | "connected";

export const SAFE_COMPATIBILITY = new Set<RemoteCompatibility["kind"]>(["empty", "up-to-date", "remote-behind"]);

export function describeCompatibility(compatibility: RemoteCompatibility): {
  safe: boolean;
  title: string;
  description: string;
} {
  switch (compatibility.kind) {
    case "empty":
      return { safe: true, title: "Empty repository", description: "Ready to publish this project's history." };
    case "up-to-date":
      return { safe: true, title: "Same project history", description: "The local and GitHub versions match." };
    case "remote-behind":
      return {
        safe: true,
        title: "Previously connected project",
        description: `${compatibility.localAhead} local ${compatibility.localAhead === 1 ? "version is" : "versions are"} ready to publish.`,
      };
    case "remote-ahead":
      return {
        safe: false,
        title: "GitHub has newer versions",
        description: "Updating the local project from GitHub is not supported yet.",
      };
    case "diverged":
      return {
        safe: false,
        title: "Project histories have diverged",
        description: "Resolve or merge the histories with Git before reconnecting.",
      };
    case "unrelated":
      return {
        safe: false,
        title: "Not the same project",
        description: "Choose an empty repository or one previously connected to this project.",
      };
  }
}

export function buildGitHubNewRepoUrl(name: string, visibility: RepositoryVisibility): string {
  const params = new URLSearchParams({ name, visibility, owner: "@me" });
  return `https://github.com/new?${params.toString()}`;
}

export function validateRepositoryName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a repository name.";
  if (name.length > 100) return "Use 100 characters or fewer.";
  if (!REPO_NAME_PATTERN.test(name)) return "Use letters, numbers, dots, underscores, or hyphens.";
  if (name === "." || name === "..") return "Choose a different repository name.";
  return null;
}

export function validateRepositoryInput(value: string): string | null {
  return parseRepositoryInput(value) ? null : "Enter owner/repository or a github.com repository URL.";
}

export function parseRepositoryInput(value: string): { owner: string; name: string } | null {
  const normalized = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!/^[A-Za-z0-9-]+$/.test(parts[0]) || validateRepositoryName(parts[1])) return null;
  return { owner: parts[0], name: parts[1] };
}

export function normalizeDefaultRepositoryName(value: string | undefined): string {
  const normalized = (value?.trim() || "viritura-score")
    .replace(/\.mnx$/i, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return normalized || "viritura-score";
}

export function formatDefaultRepository(owner: string, name: string): string {
  return owner ? `${owner}/${name}` : name;
}

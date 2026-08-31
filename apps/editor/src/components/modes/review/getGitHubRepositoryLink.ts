function buildGitHubRepositoryLink(owner: string, repo: string): { fullName: string; htmlUrl: string } | null {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim().replace(/\.git$/i, "");
  if (!normalizedOwner || !normalizedRepo) return null;
  const fullName = `${normalizedOwner}/${normalizedRepo}`;
  return {
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
  };
}

export function getGitHubRepositoryLink(remoteUrl: string | null): { fullName: string; htmlUrl: string } | null {
  if (!remoteUrl) return null;

  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?git@github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i);
  const sshOwner = sshMatch?.groups?.owner;
  const sshRepo = sshMatch?.groups?.repo;
  if (sshOwner && sshRepo) {
    return buildGitHubRepositoryLink(sshOwner, sshRepo);
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return buildGitHubRepositoryLink(owner, repo.replace(/\.git$/i, ""));
  } catch {
    return null;
  }
}

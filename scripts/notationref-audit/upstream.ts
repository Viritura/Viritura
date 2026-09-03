import type { ConceptNode, FormatMatrix, UpstreamSnapshot } from "./update";

interface GitHubCommit {
  sha: string;
}

const SOURCES = {
  taxonomy: {
    repository: "w3c-cg/music-notationref",
    ref: "main",
    path: "concepts.json",
  },
  mnx: {
    repository: "w3c-cg/mnx",
    ref: "main",
    path: "docs/notationref.json",
  },
  musicXml: {
    repository: "w3c-cg/musicxml",
    ref: "gh-pages",
    path: "notationref.json",
  },
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const token = process.env["GITHUB_TOKEN"];
  const useToken = token && url.startsWith("https://api.github.com/");
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Viritura-notationref-audit",
      ...(useToken ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

async function resolveCommit(repository: string, ref: string): Promise<string> {
  const commit = await fetchJson<GitHubCommit>(`https://api.github.com/repos/${repository}/commits/${ref}`);
  if (!/^[0-9a-f]{40}$/.test(commit.sha))
    throw new Error(`GitHub returned an invalid commit SHA for ${repository}@${ref}.`);
  return commit.sha;
}

async function fetchAtCommit<T>(repository: string, commit: string, path: string): Promise<T> {
  return fetchJson<T>(`https://raw.githubusercontent.com/${repository}/${commit}/${path}`);
}

export async function fetchUpstreamSnapshot(): Promise<UpstreamSnapshot> {
  const [taxonomyCommit, mnxCommit, musicXmlCommit] = await Promise.all([
    resolveCommit(SOURCES.taxonomy.repository, SOURCES.taxonomy.ref),
    resolveCommit(SOURCES.mnx.repository, SOURCES.mnx.ref),
    resolveCommit(SOURCES.musicXml.repository, SOURCES.musicXml.ref),
  ]);
  const [concepts, mnx, musicXml] = await Promise.all([
    fetchAtCommit<ConceptNode[]>(SOURCES.taxonomy.repository, taxonomyCommit, SOURCES.taxonomy.path),
    fetchAtCommit<FormatMatrix>(SOURCES.mnx.repository, mnxCommit, SOURCES.mnx.path),
    fetchAtCommit<FormatMatrix>(SOURCES.musicXml.repository, musicXmlCommit, SOURCES.musicXml.path),
  ]);
  return {
    metadata: { taxonomyCommit, mnxCommit, musicXmlCommit },
    concepts,
    mnx,
    musicXml,
  };
}

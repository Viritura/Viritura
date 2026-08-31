/**
 * GitProjectAdapter — wraps an isomorphic-git repository against any
 * IsoGitFs filesystem (OPFS, FSA, in-memory).
 *
 * The score lives at `<scorePath>` inside the repo root. The repo root is
 * always `/` from the FS adapter's point of view; the FS adapter handles
 * mapping that onto the underlying storage (OPFS subroot, FSA root handle,
 * in-memory map).
 */

import git, { type GitHttpRequest, type GitHttpResponse, type HttpClient } from "isomorphic-git";
import type { IsoGitFs } from "./fs/types";
import { type CommitInfo, type ProjectAdapter, type ProjectStatus } from "./ProjectAdapter";
import { getIdentity } from "./identity";

const DEFAULT_BRANCH = "main";

export interface GitAdapterOptions {
  fs: IsoGitFs;
  /** Display name for the project (e.g. folder name). */
  name: string;
  /** Path of the score file inside the repo, e.g. "score.mnx". */
  scorePath: string;
}

/**
 * Initialise a fresh repository, writing the initial score and creating
 * the first commit. Safe to call against an empty FS.
 */
export async function initRepo(opts: {
  fs: IsoGitFs;
  name: string;
  scorePath: string;
  initialJson: string;
  initialMessage?: string;
}): Promise<GitProjectAdapter> {
  await git.init({ fs: opts.fs, dir: "/", defaultBranch: DEFAULT_BRANCH });
  const adapter = new GitProjectAdapter({
    fs: opts.fs,
    name: opts.name,
    scorePath: opts.scorePath,
  });
  await adapter.writeScore(opts.initialJson);
  const sha = await adapter.commit(opts.initialMessage ?? "Initial draft");
  if (sha == null) {
    throw new Error("initial commit produced no SHA");
  }
  return adapter;
}

/** Open an existing repo previously initialised on `fs`. */
export async function openRepo(opts: GitAdapterOptions): Promise<GitProjectAdapter> {
  const adapter = new GitProjectAdapter(opts);
  try {
    await git.resolveRef({ fs: opts.fs, dir: "/", ref: "HEAD" });
    return adapter;
  } catch (cause) {
    if (!(await hasUnbornHead(opts.fs))) {
      throw new Error(`No git repository at root of ${opts.name}`, { cause });
    }
  }

  const sha = await adapter.commit("Initial draft");
  if (sha == null) {
    throw new Error(`Could not create the initial commit for ${opts.name}`);
  }
  return adapter;
}

async function hasUnbornHead(fs: IsoGitFs): Promise<boolean> {
  let head: string;
  try {
    const data = await fs.readFile("/.git/HEAD", { encoding: "utf8" });
    head = typeof data === "string" ? data : new TextDecoder().decode(data);
  } catch {
    return false;
  }

  const match = /^ref: (refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*)\s*$/.exec(head);
  if (!match || match[1]!.includes("..") || match[1]!.endsWith("/") || match[1]!.endsWith(".")) {
    return false;
  }

  try {
    await fs.stat(`/.git/${match[1]!}`);
    return false;
  } catch (error) {
    if (!isMissingFile(error)) return false;
  }

  try {
    const data = await fs.readFile("/.git/packed-refs", { encoding: "utf8" });
    const packedRefs = typeof data === "string" ? data : new TextDecoder().decode(data);
    return !packedRefs.split(/\r?\n/).some((line) => line.endsWith(` ${match[1]!}`));
  } catch (error) {
    return isMissingFile(error);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class GitProjectAdapter implements ProjectAdapter {
  readonly mode = "project" as const;
  name: string;
  private fs: IsoGitFs;
  private scorePath: string;

  constructor(opts: GitAdapterOptions) {
    this.fs = opts.fs;
    this.name = opts.name;
    this.scorePath = opts.scorePath.startsWith("/") ? opts.scorePath.slice(1) : opts.scorePath;
  }

  isVersioned(): boolean {
    return true;
  }

  // ── File IO ──

  async readScore(): Promise<string> {
    const data = await this.fs.readFile("/" + this.scorePath, { encoding: "utf8" });
    return typeof data === "string" ? data : new TextDecoder().decode(data);
  }

  async writeScore(json: string): Promise<void> {
    await this.fs.writeFile("/" + this.scorePath, json, { encoding: "utf8" });
  }

  // ── Status ──

  async status(): Promise<ProjectStatus> {
    let dirty = false;
    let branch: string | null = null;
    let remoteUrl: string | null = null;
    let aheadCount: number | null = null;
    let behindCount: number | null = null;
    let commitCount = 0;
    try {
      const status = await git.status({ fs: this.fs, dir: "/", filepath: this.scorePath });
      // "unmodified" or "*unmodified" means working tree matches HEAD.
      dirty = status !== "unmodified" && status !== "*unmodified";
    } catch {
      dirty = true;
    }
    try {
      branch = (await git.currentBranch({ fs: this.fs, dir: "/", fullname: false })) ?? DEFAULT_BRANCH;
    } catch {
      branch = DEFAULT_BRANCH;
    }
    try {
      remoteUrl = (await git.getConfig({ fs: this.fs, dir: "/", path: "remote.origin.url" })) ?? null;
    } catch {
      remoteUrl = null;
    }
    const commits = await this.readCommitLog(1000);
    commitCount = commits.length;
    if (remoteUrl && branch) {
      const counts = await this.countAheadBehind(
        branch,
        commits.map((commit) => commit.oid),
      );
      aheadCount = counts.ahead;
      behindCount = counts.behind;
    }
    return {
      mode: "project",
      name: this.name,
      dirty,
      branch,
      remoteUrl,
      aheadCount,
      behindCount,
      commitCount,
    };
  }

  // ── Versioning ──

  async commit(message: string): Promise<string | null> {
    // Skip empty commits — if working tree matches HEAD there is nothing to record.
    let isDirty = true;
    try {
      const s = await git.status({ fs: this.fs, dir: "/", filepath: this.scorePath });
      isDirty = s !== "unmodified" && s !== "*unmodified";
    } catch {
      // Status check can fail on first commit; assume dirty.
      isDirty = true;
    }
    if (!isDirty) return null;

    await git.add({ fs: this.fs, dir: "/", filepath: this.scorePath });
    const ident = getIdentity();
    const sha = await git.commit({
      fs: this.fs,
      dir: "/",
      message,
      author: { name: ident.name, email: ident.email, timestamp: Math.floor(Date.now() / 1000) },
    });
    return sha;
  }

  async log(limit: number = 100): Promise<CommitInfo[]> {
    const commits = await this.readCommitLog(limit);

    // Build an SHA → refs map so we can decorate entries with branch/tag chips.
    const refMap: Record<string, string[]> = {};
    try {
      const branches = await git.listBranches({ fs: this.fs, dir: "/" });
      for (const b of branches) {
        try {
          const sha = await git.resolveRef({ fs: this.fs, dir: "/", ref: b });
          (refMap[sha] ??= []).push(b);
        } catch {
          /* ignore missing refs */
        }
      }
      const tags = await git.listTags({ fs: this.fs, dir: "/" });
      for (const t of tags) {
        try {
          const sha = await git.resolveRef({ fs: this.fs, dir: "/", ref: `refs/tags/${t}` });
          (refMap[sha] ??= []).push(`tag:${t}`);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* refs are best-effort */
    }

    return commits.map(({ oid, commit }) => {
      const subject = (commit.message || "").split("\n")[0] ?? "";
      return {
        sha: oid,
        shortSha: oid.slice(0, 7),
        parents: commit.parent ?? [],
        message: commit.message,
        subject,
        author: { name: commit.author.name, email: commit.author.email },
        timestamp: commit.author.timestamp * 1000,
        auto: /\[auto\]\s*$/.test(subject),
        refs: refMap[oid] ?? [],
      };
    });
  }

  async readScoreAtCommit(sha: string): Promise<string> {
    try {
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: "/",
        oid: sha,
        filepath: this.scorePath,
      });
      return new TextDecoder().decode(blob);
    } catch (err) {
      throw new Error(`Could not read score at commit ${sha.slice(0, 7)}: ${(err as Error).message}`);
    }
  }

  async setRemoteUrl(remote: string, url: string): Promise<void> {
    await git.setConfig({ fs: this.fs, dir: "/", path: `remote.${remote}.url`, value: url });
    await git.setConfig({
      fs: this.fs,
      dir: "/",
      path: `remote.${remote}.fetch`,
      value: `+refs/heads/*:refs/remotes/${remote}/*`,
    });
  }

  async push(options: { remote?: string; corsProxy: string }): Promise<void> {
    const remote = options.remote ?? "origin";
    const branch = (await git.currentBranch({ fs: this.fs, dir: "/", fullname: false })) ?? DEFAULT_BRANCH;
    await git.push({
      fs: this.fs,
      http: credentialedHttp,
      dir: "/",
      remote,
      ref: branch,
      remoteRef: branch,
      corsProxy: options.corsProxy,
    });
    const head = await git.resolveRef({ fs: this.fs, dir: "/", ref: "HEAD" });
    await git.writeRef({ fs: this.fs, dir: "/", ref: `refs/remotes/${remote}/${branch}`, value: head, force: true });
    await git.setConfig({ fs: this.fs, dir: "/", path: `branch.${branch}.remote`, value: remote });
    await git.setConfig({ fs: this.fs, dir: "/", path: `branch.${branch}.merge`, value: `refs/heads/${branch}` });
  }

  async fetch(options: { remote?: string; corsProxy: string }): Promise<void> {
    const remote = options.remote ?? "origin";
    const branch = (await git.currentBranch({ fs: this.fs, dir: "/", fullname: false })) ?? DEFAULT_BRANCH;
    await git.fetch({
      fs: this.fs,
      http: credentialedHttp,
      dir: "/",
      remote,
      ref: branch,
      singleBranch: true,
      tags: false,
      corsProxy: options.corsProxy,
    });
    await git.setConfig({ fs: this.fs, dir: "/", path: `branch.${branch}.remote`, value: remote });
    await git.setConfig({ fs: this.fs, dir: "/", path: `branch.${branch}.merge`, value: `refs/heads/${branch}` });
  }

  private async readCommitLog(limit: number): Promise<Awaited<ReturnType<typeof git.log>>> {
    try {
      return await git.log({ fs: this.fs, dir: "/", depth: limit });
    } catch {
      return [];
    }
  }

  private async countAheadBehind(
    branch: string,
    localOids: readonly string[],
  ): Promise<{ ahead: number; behind: number | null }> {
    if (localOids.length === 0) return { ahead: 0, behind: null };
    let remoteLog: Awaited<ReturnType<typeof git.log>>;
    try {
      remoteLog = await git.log({ fs: this.fs, dir: "/", ref: `refs/remotes/origin/${branch}`, depth: 1000 });
    } catch {
      return { ahead: localOids.length, behind: null };
    }
    const remoteOids = remoteLog.map((commit) => commit.oid);
    const localOidSet = new Set(localOids);
    const remoteOidSet = new Set(remoteOids);
    const commonLocalIndex = localOids.findIndex((oid) => remoteOidSet.has(oid));
    const commonRemoteIndex = remoteOids.findIndex((oid) => localOidSet.has(oid));
    return {
      ahead: commonLocalIndex === -1 ? localOids.length : commonLocalIndex,
      behind: commonRemoteIndex === -1 ? remoteOids.length : commonRemoteIndex,
    };
  }
}

const credentialedHttp: HttpClient = {
  async request(request: GitHttpRequest): Promise<GitHttpResponse> {
    const body = request.body ? await collectBody(request.body) : undefined;
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body,
      credentials: "include",
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      url: response.url,
      method: request.method,
      statusCode: response.status,
      statusMessage: response.statusText,
      headers,
      body: response.body ? streamChunks(response.body) : singleChunk(new Uint8Array(await response.arrayBuffer())),
    };
  },
};

async function collectBody(body: AsyncIterableIterator<Uint8Array>): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  const buffer = new ArrayBuffer(byteLength);
  const collected = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    collected.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* singleChunk(chunk: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield chunk;
}

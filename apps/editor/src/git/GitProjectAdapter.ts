/**
 * GitProjectAdapter — wraps an isomorphic-git repository against any
 * IsoGitFs filesystem (OPFS, FSA, in-memory).
 *
 * The score lives at `<scorePath>` inside the repo root. The repo root is
 * always `/` from the FS adapter's point of view; the FS adapter handles
 * mapping that onto the underlying storage (OPFS subroot, FSA root handle,
 * in-memory map).
 */

import git from "isomorphic-git";
import type { IsoGitFs } from "./fs/types";
import { type CommitInfo, type ProjectAdapter, type ProjectStatus, type RemoteCompatibility } from "./ProjectAdapter";
import { getIdentity } from "./identity";
import { removeRemoteConfig } from "./remoteConfig";
import { createCredentialedGitHttpClient } from "./gitHttpClient";

const DEFAULT_BRANCH = "main";
const SCORE_HISTORY_CACHE_SIZE = 8;

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
  private readonly scoreHistoryCache = new Map<string, Promise<string>>();

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
      const remoteBranch = await this.getTrackedRemoteBranch(branch, "origin");
      const counts = await this.countAheadBehind(
        remoteBranch,
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
    const cached = this.scoreHistoryCache.get(sha);
    if (cached) {
      this.scoreHistoryCache.delete(sha);
      this.scoreHistoryCache.set(sha, cached);
      return cached;
    }

    const read = git
      .readBlob({
        fs: this.fs,
        dir: "/",
        oid: sha,
        filepath: this.scorePath,
      })
      .then(({ blob }) => new TextDecoder().decode(blob))
      .catch((err: unknown) => {
        this.scoreHistoryCache.delete(sha);
        throw new Error(`Could not read score at commit ${sha.slice(0, 7)}: ${(err as Error).message}`);
      });
    this.scoreHistoryCache.set(sha, read);
    if (this.scoreHistoryCache.size > SCORE_HISTORY_CACHE_SIZE) {
      const oldestSha = this.scoreHistoryCache.keys().next().value;
      if (oldestSha !== undefined) this.scoreHistoryCache.delete(oldestSha);
    }
    return read;
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

  async removeRemote(remote: string): Promise<void> {
    await removeRemoteConfig(this.fs, remote);
  }

  async inspectRemote(options: {
    url: string;
    defaultBranch: string;
    corsProxy: string;
  }): Promise<RemoteCompatibility> {
    const refs = await git.listServerRefs({
      http: credentialedHttp,
      url: options.url,
      corsProxy: options.corsProxy,
      symrefs: true,
    });
    const branchRefs = refs.filter((ref) => ref.ref.startsWith("refs/heads/"));
    const branch =
      options.defaultBranch ||
      refs.find((ref) => ref.ref === "HEAD")?.target?.replace(/^refs\/heads\//, "") ||
      DEFAULT_BRANCH;
    if (branchRefs.length === 0) {
      return { kind: "empty", branch, localAhead: (await this.readCommitLog(1000)).length, remoteAhead: 0 };
    }

    const remoteBranch = branchRefs.find((ref) => ref.ref === `refs/heads/${branch}`);
    if (!remoteBranch) {
      throw new Error(`GitHub's default branch '${branch}' was not advertised by the repository.`);
    }

    const inspectionRemote = `viritura-inspect-${Math.random().toString(36).slice(2)}`;
    await this.setRemoteUrl(inspectionRemote, options.url);
    let fetched: Awaited<ReturnType<typeof git.fetch>>;
    try {
      fetched = await git.fetch({
        fs: this.fs,
        http: credentialedHttp,
        dir: "/",
        remote: inspectionRemote,
        ref: branch,
        remoteRef: branch,
        singleBranch: true,
        tags: false,
        corsProxy: options.corsProxy,
      });
    } finally {
      await this.removeRemote(inspectionRemote);
    }
    const remoteOid = fetched.fetchHead ?? remoteBranch.oid;
    const localOid = await git.resolveRef({ fs: this.fs, dir: "/", ref: "HEAD" });
    return await this.classifyRemoteHistory(branch, localOid, remoteOid);
  }

  async push(options: { remote?: string; remoteRef?: string; corsProxy: string }): Promise<void> {
    const remote = options.remote ?? "origin";
    const branch = (await git.currentBranch({ fs: this.fs, dir: "/", fullname: false })) ?? DEFAULT_BRANCH;
    const remoteBranch = options.remoteRef ?? (await this.getTrackedRemoteBranch(branch, remote));
    await git.push({
      fs: this.fs,
      http: credentialedHttp,
      dir: "/",
      remote,
      ref: branch,
      remoteRef: remoteBranch,
      corsProxy: options.corsProxy,
    });
    const head = await git.resolveRef({ fs: this.fs, dir: "/", ref: "HEAD" });
    await git.writeRef({
      fs: this.fs,
      dir: "/",
      ref: `refs/remotes/${remote}/${remoteBranch}`,
      value: head,
      force: true,
    });
    await git.setConfig({ fs: this.fs, dir: "/", path: `branch.${branch}.remote`, value: remote });
    await git.setConfig({
      fs: this.fs,
      dir: "/",
      path: `branch.${branch}.merge`,
      value: `refs/heads/${remoteBranch}`,
    });
  }

  async fetch(options: { remote?: string; corsProxy: string }): Promise<void> {
    const remote = options.remote ?? "origin";
    const branch = (await git.currentBranch({ fs: this.fs, dir: "/", fullname: false })) ?? DEFAULT_BRANCH;
    const remoteBranch = await this.getTrackedRemoteBranch(branch, remote);
    await git.fetch({
      fs: this.fs,
      http: credentialedHttp,
      dir: "/",
      remote,
      ref: remoteBranch,
      remoteRef: remoteBranch,
      singleBranch: true,
      tags: false,
      corsProxy: options.corsProxy,
    });
    await git.setConfig({ fs: this.fs, dir: "/", path: `branch.${branch}.remote`, value: remote });
    await git.setConfig({
      fs: this.fs,
      dir: "/",
      path: `branch.${branch}.merge`,
      value: `refs/heads/${remoteBranch}`,
    });
  }

  private async getTrackedRemoteBranch(branch: string, remote: string): Promise<string> {
    try {
      const configuredRemote = await git.getConfig({
        fs: this.fs,
        dir: "/",
        path: `branch.${branch}.remote`,
      });
      const mergeRef = await git.getConfig({
        fs: this.fs,
        dir: "/",
        path: `branch.${branch}.merge`,
      });
      if (configuredRemote === remote && mergeRef?.startsWith("refs/heads/")) {
        return mergeRef.slice("refs/heads/".length);
      }
    } catch {
      // Missing tracking configuration falls back to the local branch name.
    }
    return branch;
  }

  private async readCommitLog(limit: number): Promise<Awaited<ReturnType<typeof git.log>>> {
    try {
      return await git.log({ fs: this.fs, dir: "/", depth: limit });
    } catch {
      return [];
    }
  }

  private async countAheadBehind(
    remoteBranch: string,
    localOids: readonly string[],
  ): Promise<{ ahead: number; behind: number | null }> {
    if (localOids.length === 0) return { ahead: 0, behind: null };
    let remoteLog: Awaited<ReturnType<typeof git.log>>;
    try {
      remoteLog = await git.log({ fs: this.fs, dir: "/", ref: `refs/remotes/origin/${remoteBranch}`, depth: 1000 });
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

  private async classifyRemoteHistory(
    branch: string,
    localOid: string,
    remoteOid: string,
  ): Promise<RemoteCompatibility> {
    if (localOid === remoteOid) {
      return { kind: "up-to-date", branch, localAhead: 0, remoteAhead: 0 };
    }

    const localDescendsFromRemote = await git.isDescendent({
      fs: this.fs,
      dir: "/",
      oid: localOid,
      ancestor: remoteOid,
    });
    if (localDescendsFromRemote) {
      const localLog = await git.log({ fs: this.fs, dir: "/", ref: localOid });
      const remoteIndex = localLog.findIndex((commit) => commit.oid === remoteOid);
      return { kind: "remote-behind", branch, localAhead: remoteIndex, remoteAhead: 0 };
    }

    const remoteDescendsFromLocal = await git.isDescendent({
      fs: this.fs,
      dir: "/",
      oid: remoteOid,
      ancestor: localOid,
    });
    if (remoteDescendsFromLocal) {
      const remoteLog = await git.log({ fs: this.fs, dir: "/", ref: remoteOid });
      const localIndex = remoteLog.findIndex((commit) => commit.oid === localOid);
      return { kind: "remote-ahead", branch, localAhead: 0, remoteAhead: localIndex };
    }

    const mergeBases = await git.findMergeBase({ fs: this.fs, dir: "/", oids: [localOid, remoteOid] });
    return {
      kind: mergeBases.length > 0 ? "diverged" : "unrelated",
      branch,
      localAhead: 0,
      remoteAhead: 0,
    };
  }
}

const credentialedHttp = createCredentialedGitHttpClient();

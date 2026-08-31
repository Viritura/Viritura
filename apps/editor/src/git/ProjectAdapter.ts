/**
 * ProjectAdapter — storage-agnostic facade over standalone files vs git
 * project folders. The rest of the editor (UI, store, commands) talks to
 * this interface and never imports isomorphic-git or filesystem APIs
 * directly.
 *
 * See docs/plans/git-versioning.md for the full design.
 */

type ProjectMode = "standalone" | "project";

export interface CommitInfo {
  sha: string;
  shortSha: string;
  parents: string[];
  message: string;
  /** First line of the message (commit subject). */
  subject: string;
  author: { name: string; email: string };
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Auto-generated snapshot? Detected from the "[auto]" suffix in subject. */
  auto: boolean;
  /** Refs (branches/tags) pointing at this commit, e.g. ["main"]. */
  refs: string[];
}

export interface ProjectStatus {
  mode: ProjectMode;
  /** Human-readable name of the project / file. */
  name: string;
  /** True if working-tree differs from HEAD (always false in standalone mode). */
  dirty: boolean;
  /** Current branch (project mode) or null (standalone). */
  branch: string | null;
  /** Git remote origin URL (project mode) or null when not connected. */
  remoteUrl: string | null;
  /** Number of local commits ahead of origin/<branch>; null when no remote is configured. */
  aheadCount: number | null;
  /** Number of remote commits ahead of the local branch; null when no remote has been fetched. */
  behindCount: number | null;
  /** Total commits in the current branch's history. */
  commitCount: number;
}

export interface ProjectAdapter {
  readonly mode: ProjectMode;
  readonly name: string;

  /** Read the current working-tree score JSON. */
  readScore(): Promise<string>;
  /** Persist the current score JSON. Does NOT commit. */
  writeScore(json: string): Promise<void>;

  status(): Promise<ProjectStatus>;

  // ── Versioning (no-op or throws in standalone mode) ──

  /** True when this adapter actually tracks history. */
  isVersioned(): boolean;

  /**
   * Commit the current working-tree score with the given message.
   * Returns the SHA of the new commit.
   *
   * Implementations should be idempotent for empty diffs — when there is
   * nothing to commit, return null and leave HEAD untouched.
   */
  commit(message: string): Promise<string | null>;

  /** List commits, newest first. Pass `limit` (default 100) for pagination. */
  log(limit?: number): Promise<CommitInfo[]>;

  /** Read the score blob at a specific commit SHA. */
  readScoreAtCommit(sha: string): Promise<string>;

  /** Set a git remote URL. Only meaningful in project mode. */
  setRemoteUrl(remote: string, url: string): Promise<void>;

  /** Push the current branch to a configured remote. Only meaningful in project mode. */
  push(options: { remote?: string; corsProxy: string }): Promise<void>;

  /** Fetch remote refs without merging. Only meaningful in project mode. */
  fetch(options: { remote?: string; corsProxy: string }): Promise<void>;
}

export class StandaloneNotSupportedError extends Error {
  constructor(operation: string) {
    super(`${operation} is not available in standalone mode`);
    this.name = "StandaloneNotSupportedError";
  }
}

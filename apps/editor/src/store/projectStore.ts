/**
 * Project store — global state about the currently-open project.
 *
 * Owns the active ProjectAdapter (Standalone or Git), the cached commit log,
 * and the Review-mode `from`/`to` selection.
 *
 * The rest of the app reads from this store and dispatches actions on it
 * via the helper functions below.
 */

import { create } from "zustand";
import {
  StandaloneProjectAdapter,
  initRepo,
  openRepo,
  type CommitInfo,
  type GitProjectAdapter,
  type ProjectAdapter,
  type ProjectStatus,
  synthesizeCommitMessage,
} from "../git";
import { FsaFs } from "../git/fs/fsaFs";
import { rememberScore } from "./recentScores";

/**
 * Sentinel SHA representing the live working tree.
 *
 * Used in the review `from`/`to` selectors so "compare uncommitted changes
 * against HEAD" is the default zero-click path.
 */
export const WORKING_TREE_SHA = "__working_tree__";

export interface ReviewSelection {
  /** SHA on the left side of the diff (red). */
  from: string | null;
  /** SHA on the right side of the diff (green). */
  to: string | null;
}

export interface ProjectState {
  adapter: ProjectAdapter | null;
  status: ProjectStatus | null;
  /** Commit log, newest first. Empty array in standalone mode. */
  log: CommitInfo[];
  /** Review mode `from`/`to` selection. */
  selection: ReviewSelection;
  /** True while a save→commit pipeline is in flight. */
  committing: boolean;

  // ── Actions ──

  /** Replace the active adapter and refresh derived state. */
  setAdapter(adapter: ProjectAdapter | null): Promise<void>;

  /** Re-read status + log (typically after a commit or external change). */
  refresh(): Promise<void>;

  /** Fetch remote refs, then re-read local status + log. */
  fetchRemote(options: { corsProxy: string }): Promise<void>;

  /**
   * Synthesize a commit message and commit. No-op if not in project mode
   * or if the working tree matches HEAD. Returns the new SHA or null.
   */
  commitCurrent(currentJson: string, opts?: { auto?: boolean }): Promise<string | null>;

  /** Update review selection. */
  setSelection(sel: Partial<ReviewSelection>): void;
  selectCommitForDiff(sha: string): void;
  /**
   * Toggle a sha in the review selection (checkbox behaviour).
   * Maintains an ordered set of up to 2 entries; the chronologically older
   * sha becomes `from` and the newer becomes `to`. WORKING_TREE_SHA always
   * sorts as newest. Selecting a third sha evicts the oldest selection.
   */
  toggleSelection(sha: string): void;
  swapSelection(): void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  adapter: null,
  status: null,
  log: [],
  selection: { from: null, to: WORKING_TREE_SHA },
  committing: false,

  async setAdapter(adapter) {
    set({ adapter, log: [], status: null, selection: { from: null, to: WORKING_TREE_SHA } });
    if (adapter) await get().refresh();
  },

  async refresh() {
    const { adapter } = get();
    if (!adapter) {
      set({ status: null, log: [] });
      return;
    }
    const status = await adapter.status();
    let log: CommitInfo[] = [];
    if (adapter.isVersioned()) {
      log = await adapter.log(200);
    }
    // Default selection: from = HEAD's parent (or HEAD itself if root commit), to = working tree
    const selection = computeDefaultSelection(log, get().selection);
    set({ status, log, selection });
  },

  async fetchRemote(options) {
    const { adapter } = get();
    if (!adapter?.isVersioned()) return;
    await adapter.fetch({ corsProxy: options.corsProxy });
    await get().refresh();
  },

  async commitCurrent(currentJson, opts) {
    const { adapter } = get();
    if (!adapter || !adapter.isVersioned()) return null;
    set({ committing: true });
    try {
      // Pull previous commit's content for the diff.
      let prev: string | null = null;
      const log = get().log;
      if (log.length > 0) {
        try {
          prev = await adapter.readScoreAtCommit(log[0]!.sha);
        } catch {
          prev = null;
        }
      }
      const synth = synthesizeCommitMessage(prev, currentJson, { auto: opts?.auto });
      if (synth.empty) {
        return null;
      }
      await adapter.writeScore(currentJson);
      const sha = await adapter.commit(synth.subject);
      await get().refresh();
      return sha;
    } finally {
      set({ committing: false });
    }
  },

  setSelection(sel) {
    set((s) => ({ selection: { ...s.selection, ...sel } }));
  },

  selectCommitForDiff(sha) {
    const { log } = get();
    const idx = log.findIndex((c) => c.sha === sha);
    if (idx === -1) return;
    const parent = log[idx]!.parents[0] ?? null;
    set({ selection: { from: parent, to: sha } });
  },

  toggleSelection(sha) {
    const { log, selection } = get();
    const indexOf = (s: string | null): number => {
      if (s === null) return Number.POSITIVE_INFINITY;
      if (s === WORKING_TREE_SHA) return -1;
      const i = log.findIndex((c) => c.sha === s);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    };
    // Newest-first log + working-tree-as-newest means smaller index = newer.
    const newer = (a: string, b: string) => (indexOf(a) <= indexOf(b) ? a : b);
    const older = (a: string, b: string) => (indexOf(a) >= indexOf(b) ? a : b);

    const current = new Set<string>();
    if (selection.from) current.add(selection.from);
    if (selection.to) current.add(selection.to);

    if (current.has(sha)) {
      // Uncheck: drop it. Whatever remains stays as `to`; `from` becomes null.
      current.delete(sha);
      if (current.size === 0) {
        set({ selection: { from: null, to: null } });
      } else {
        const remaining = [...current][0]!;
        set({ selection: { from: null, to: remaining } });
      }
      return;
    }

    if (current.size < 2) {
      current.add(sha);
      const arr = [...current];
      if (arr.length === 1) {
        set({ selection: { from: null, to: arr[0]! } });
      } else {
        set({ selection: { from: older(arr[0]!, arr[1]!), to: newer(arr[0]!, arr[1]!) } });
      }
      return;
    }

    // Already 2 selected — evict the oldest, add the new one.
    const arr = [...current];
    const oldest = older(arr[0]!, arr[1]!);
    current.delete(oldest);
    current.add(sha);
    const next = [...current];
    set({ selection: { from: older(next[0]!, next[1]!), to: newer(next[0]!, next[1]!) } });
  },

  swapSelection() {
    set((s) => ({ selection: { from: s.selection.to, to: s.selection.from } }));
  },
}));

function computeDefaultSelection(log: CommitInfo[], current: ReviewSelection): ReviewSelection {
  // Preserve existing selection if both refs still exist (or are the working tree).
  const validShas = new Set(log.map((c) => c.sha));
  validShas.add(WORKING_TREE_SHA);
  const fromOk = current.from === null || validShas.has(current.from);
  const toOk = current.to === null || validShas.has(current.to);
  if (fromOk && toOk) {
    // If from is null but to is set and we have commits, fill in from = HEAD.
    // This ensures the diff has a real baseline instead of an empty string.
    if (current.from === null && current.to !== null && log.length > 0) {
      const headSha = log[0]!.sha;
      // If to IS the head commit, diff against its parent instead.
      const parentSha = log[0]!.parents[0] ?? null;
      const from = current.to === headSha ? parentSha : headSha;
      return { from, to: current.to };
    }
    return current;
  }
  if (log.length === 0) return { from: null, to: WORKING_TREE_SHA };
  return { from: log[0]!.sha, to: WORKING_TREE_SHA };
}

// ─── Bootstrappers ──────────────────────────────────────────────

export async function bootStandalone(opts: {
  fileName: string;
  initialJson: string;
  fileHandle?: FileSystemFileHandle | null;
  onWrite?: (json: string) => void;
}): Promise<StandaloneProjectAdapter> {
  const adapter = new StandaloneProjectAdapter(opts);
  await useProjectStore.getState().setAdapter(adapter);
  return adapter;
}

export async function bootProjectFromHandle(opts: {
  rootHandle: FileSystemDirectoryHandle;
  scorePath: string;
  /** If true, initialise a new repo with `initialJson`. Otherwise open existing. */
  init?: { initialJson: string; initialMessage?: string };
}): Promise<GitProjectAdapter> {
  const fs = new FsaFs(opts.rootHandle);
  let adapter: GitProjectAdapter;
  if (opts.init) {
    adapter = await initRepo({
      fs,
      name: opts.rootHandle.name,
      scorePath: opts.scorePath,
      initialJson: opts.init.initialJson,
      initialMessage: opts.init.initialMessage,
    });
  } else {
    adapter = await openRepo({
      fs,
      name: opts.rootHandle.name,
      scorePath: opts.scorePath,
    });
  }
  await useProjectStore.getState().setAdapter(adapter);
  // Persist this project as a recent score so it shows up in the Start
  // Center / Open Recent menu. We resolve the file handle for the score so
  // the entry is fully self-contained even if the user later opens this
  // recent without re-picking the folder.
  try {
    const fileHandle = await resolveFileHandle(opts.rootHandle, opts.scorePath);
    if (fileHandle) {
      await rememberScore({
        scoreName: lastSegment(opts.scorePath),
        fileHandle,
        vcs: {
          rootHandle: opts.rootHandle,
          rootName: opts.rootHandle.name,
          scoreRelPath: opts.scorePath,
        },
      });
    }
  } catch (err) {
    console.warn("Failed to record recent project score:", err);
  }
  return adapter;
}

async function resolveFileHandle(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<FileSystemFileHandle | null> {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let dir: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]!);
    } catch {
      return null;
    }
  }
  try {
    return await dir.getFileHandle(parts[parts.length - 1]!);
  } catch {
    return null;
  }
}

function lastSegment(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

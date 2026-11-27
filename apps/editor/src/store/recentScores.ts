/**
 * Recent Scores — unified persistence for both folder-backed projects
 * and standalone (plain) MNX files.
 *
 * Replaces the earlier split between `recentProjects.ts` and
 * `recentFiles.ts`. A single store gives us:
 *   • one merged, time-ordered list in the Start Center / Open Recent menu,
 *   • a clean upgrade path: a "plain" recent can later acquire a `vcs`
 *     pointer when the user opens its containing project folder,
 *   • one source of truth for permission re-prompts and handle storage.
 *
 * The two retired DBs (`viritura-projects`, `viritura-recent-files`) are
 * read once on first access and merged into the new DB. They are NOT
 * deleted afterwards so a user who rolls back briefly still sees their
 * old recents — they're harmless once empty migrate-on-load is idempotent.
 */

const DB_NAME = "viritura-recent-scores";
const DB_VERSION = 1;
const STORE = "recent";

const LEGACY_PROJECTS_DB = "viritura-projects";
const LEGACY_FILES_DB = "viritura-recent-files";

/** `vcs` identifies folder-backed projects, including unversioned folders. */
export interface RecentScore {
  /** Stable id (display name + short hash). */
  id: string;
  /** Display name — the score file name (e.g. "symphony.mnx"). */
  scoreName: string;
  /** Last opened timestamp (ms since epoch). */
  lastOpened: number;
  /**
   * The score file handle. Always populated; for project scores it's a snapshot
   * captured at last open and used as a fast path / fallback. The
   * authoritative location is `vcs.rootHandle` + `vcs.scoreRelPath`.
   */
  fileHandle: FileSystemFileHandle;
  /**
   * Present when the score lives inside a folder-backed (typically Git)
   * project. Absent for standalone files.
   */
  vcs?: {
    /** Folder handle for the project root. */
    rootHandle: FileSystemDirectoryHandle;
    /** Display name for the project root folder. */
    rootName: string;
    /** POSIX path of the score relative to `rootHandle`. */
    scoreRelPath: string;
    /** False for a folder opened without Git. Older entries are versioned. */
    versioned?: boolean;
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((result) => {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
      .catch(reject);
  });
}

function makeId(name: string): string {
  let h = 0;
  const stamp = `${name}|${Date.now()}|${Math.random()}`;
  for (let i = 0; i < stamp.length; i++) h = (h * 31 + stamp.charCodeAt(i)) | 0;
  return `${name}-${(h >>> 0).toString(36)}`;
}

let pendingOperation: Promise<unknown> = Promise.resolve();

function runRecentOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingOperation.then(operation);
  pendingOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function sameRecentHandle(left: FileSystemHandle, right: FileSystemHandle): Promise<boolean> {
  if (left === right) return true;
  if (!left.isSameEntry) return false;
  try {
    return await waitForHandleResult(left.isSameEntry(right), 1000, new Error("Recent location comparison timed out"));
  } catch (error) {
    console.warn("Could not compare recent locations:", error);
    return false;
  }
}

async function readRecentScores(): Promise<RecentScore[]> {
  await migrateLegacyOnce();
  const all = await withStore("readonly", (store) => {
    return new Promise<RecentScore[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as RecentScore[]) ?? [];
        all.sort((a, b) => b.lastOpened - a.lastOpened);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  });
  const duplicates = await Promise.all(
    all.map(async (entry, index) => {
      const root = entry.vcs?.rootHandle;
      if (!root) return false;
      const matches = await Promise.all(
        all
          .slice(0, index)
          .flatMap((previous) => (previous.vcs ? [sameRecentHandle(previous.vcs.rootHandle, root)] : [])),
      );
      return matches.some(Boolean);
    }),
  );
  if (duplicates.some(Boolean)) {
    await withStore("readwrite", (store) => {
      all.forEach((entry, index) => {
        if (duplicates[index]) store.delete(entry.id);
      });
    });
  }
  return all.filter((_, index) => !duplicates[index]);
}

/** Returns recents newest-first, consolidating older entries for the same project. */
export function listRecentScores(): Promise<RecentScore[]> {
  return runRecentOperation(readRecentScores);
}

interface RememberScoreOptions {
  scoreName: string;
  fileHandle: FileSystemFileHandle;
  vcs?: RecentScore["vcs"];
  id?: string;
}

async function matchesRecentScore(entry: RecentScore, opts: RememberScoreOptions): Promise<boolean> {
  if (!opts.vcs) return !entry.vcs && sameRecentHandle(entry.fileHandle, opts.fileHandle);
  const root = opts.vcs.rootHandle;
  if (entry.vcs) return sameRecentHandle(entry.vcs.rootHandle, root);
  if (!root.resolve) return sameRecentHandle(entry.fileHandle, opts.fileHandle);
  try {
    return (
      (await waitForHandleResult(root.resolve(entry.fileHandle), 1000, new Error("Recent file lookup timed out"))) !==
      null
    );
  } catch (error) {
    console.warn("Could not locate a recent file in the project:", error);
    return false;
  }
}

/**
 * Insert/update one recent per project root or standalone file. Opening a
 * folder also absorbs older standalone recents located inside that folder.
 * Only standalone files use the existing file-name fallback.
 *
 * Pass a pre-existing `id` to reuse it (e.g. when upgrading a plain recent
 * to a VCS one without losing its position in the list).
 */
export function rememberScore(opts: RememberScoreOptions): Promise<RecentScore> {
  return runRecentOperation(async () => {
    const existing = await readRecentScores();
    const matches = await Promise.all(existing.map((entry) => matchesRecentScore(entry, opts)));
    const matchedEntries = existing.filter((_, index) => matches[index]);
    const sameName = opts.vcs ? undefined : existing.find((entry) => !entry.vcs && entry.scoreName === opts.scoreName);
    const id = opts.id ?? matchedEntries[0]?.id ?? sameName?.id ?? makeId(opts.vcs?.rootName ?? opts.scoreName);
    const entry: RecentScore = {
      id,
      scoreName: opts.scoreName,
      fileHandle: opts.fileHandle,
      lastOpened: Date.now(),
      ...(opts.vcs ? { vcs: opts.vcs } : {}),
    };
    await withStore("readwrite", (store) => {
      for (const previous of matchedEntries) {
        if (previous.id !== id) store.delete(previous.id);
      }
      store.put(entry);
    });
    return entry;
  });
}

export function forgetScore(id: string): Promise<void> {
  return runRecentOperation(async () => {
    await withStore("readwrite", (store) => {
      store.delete(id);
    });
  });
}

export class RecentScorePermissionTimeoutError extends Error {
  constructor() {
    super("The browser did not respond for this saved location. Choose it again to reopen.");
    this.name = "RecentScorePermissionTimeoutError";
  }
}

async function waitForHandleResult<T>(result: Promise<T>, timeoutMs: number, timeoutError: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-request permission. For project recents we ask on the root (so any score
 * in the folder is reachable); for plain recents we ask on the file handle.
 */
export async function ensureScorePermission(
  entry: RecentScore,
  mode: "read" | "readwrite" = "readwrite",
): Promise<boolean> {
  type Permissioned = {
    queryPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  };
  const target = (entry.vcs?.rootHandle ?? entry.fileHandle) as unknown as Permissioned;
  if (target.queryPermission) {
    const current = await waitForHandleResult(
      target.queryPermission({ mode }),
      5000,
      new RecentScorePermissionTimeoutError(),
    );
    if (current === "granted") return true;
  }
  if (target.requestPermission) {
    // Allow time to answer a real prompt, but do not wait forever on a stale handle.
    const next = await waitForHandleResult(
      target.requestPermission({ mode }),
      60000,
      new RecentScorePermissionTimeoutError(),
    );
    return next === "granted";
  }
  return true;
}

// ─── Legacy migration ──────────────────────────────

let migrationDone: Promise<void> | null = null;

/**
 * One-time read of the two legacy DBs. Runs at most once per page load.
 * Idempotent at the entry level: legacy entries are imported with a stable
 * id (legacy id + prefix) so a re-run of the same code path on a fresh DB
 * produces the same result.
 */
function migrateLegacyOnce(): Promise<void> {
  if (!migrationDone)
    migrationDone = doMigrate().catch((err) => {
      console.warn("Recent scores: legacy migration failed", err);
    });
  return migrationDone;
}

async function doMigrate(): Promise<void> {
  // Skip if the new DB already has anything in it (a previous migration
  // succeeded, or the user has used the new code path already).
  const existingCount = await withStore(
    "readonly",
    (store) =>
      new Promise<number>((resolve, reject) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
  if (existingCount > 0) return;

  const projects = await readLegacy<LegacyProject>(LEGACY_PROJECTS_DB);
  const files = await readLegacy<LegacyFile>(LEGACY_FILES_DB);
  if (projects.length === 0 && files.length === 0) return;

  await withStore("readwrite", (store) => {
    for (const p of projects) {
      // Legacy projects stored a directory handle and `scorePath` but no
      // file handle. We don't have a way to synthesize one without async
      // work inside this transaction, so we stash the directory handle in a
      // "pending" form: scoreName as the file basename, fileHandle as the
      // root handle (cast). The first time the user re-opens this entry,
      // the open path will resolve the real file handle and call
      // `rememberScore` again, replacing this stub with a proper entry.
      // We keep `vcs.scoreRelPath` so the resolver can find the file.
      const id = `legacy-p-${p.id}`;
      store.put({
        id,
        scoreName: lastPathSegment(p.scorePath) || p.name,
        // Cast: we know this isn't a real file handle, but the open path
        // recognises a `vcs` entry and resolves the file from the root.
        fileHandle: p.handle as unknown as FileSystemFileHandle,
        lastOpened: p.lastOpened,
        vcs: {
          rootHandle: p.handle,
          rootName: p.name,
          scoreRelPath: p.scorePath,
        },
      } satisfies RecentScore);
    }
    for (const f of files) {
      const id = `legacy-f-${f.id}`;
      store.put({
        id,
        scoreName: f.name,
        fileHandle: f.handle,
        lastOpened: f.lastOpened,
      } satisfies RecentScore);
    }
  });
}

interface LegacyProject {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  scorePath: string;
  lastOpened: number;
}
interface LegacyFile {
  id: string;
  name: string;
  handle: FileSystemFileHandle;
  lastOpened: number;
}

function readLegacy<T>(dbName: string): Promise<T[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("recent")) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction("recent", "readonly");
      const store = tx.objectStore("recent");
      const all = store.getAll();
      all.onsuccess = () => {
        db.close();
        resolve((all.result as T[]) ?? []);
      };
      all.onerror = () => {
        db.close();
        resolve([]);
      };
    };
    req.onerror = () => resolve([]);
    req.onblocked = () => resolve([]);
  });
}

function lastPathSegment(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

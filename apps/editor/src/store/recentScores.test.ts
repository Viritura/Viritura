import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureScorePermission,
  forgetScore,
  listRecentScores,
  rememberScore,
  RecentScorePermissionTimeoutError,
  type RecentScore,
} from "./recentScores";

function recent(queryPermission: () => Promise<PermissionState>, requestPermission = vi.fn()) {
  const rootHandle = { queryPermission, requestPermission } as unknown as FileSystemDirectoryHandle;
  const entry: RecentScore = {
    id: "project",
    scoreName: "score.mnx",
    lastOpened: 0,
    fileHandle: {} as FileSystemFileHandle,
    vcs: { rootHandle, rootName: "Project", scoreRelPath: "score.mnx" },
  };
  return entry;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function storedRecents(initial: RecentScore[] = []) {
  const records = new Map(initial.map((entry) => [entry.id, entry]));
  function request<T>(result: T) {
    const req = { result, onsuccess: null as (() => void) | null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
  vi.stubGlobal("indexedDB", {
    open(name: string) {
      const entries = name === "viritura-recent-scores" ? records : new Map<string, RecentScore>();
      return request({
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
          const tx = {
            oncomplete: null as (() => void) | null,
            objectStore: () => ({
              count: () => request(entries.size),
              getAll: () => request([...entries.values()]),
              put: (entry: RecentScore) => entries.set(entry.id, entry),
              delete: (id: string) => entries.delete(id),
            }),
          };
          setTimeout(() => tx.oncomplete?.(), 0);
          return tx;
        },
      });
    },
  });
  return records;
}

const rootIdentities = new WeakMap<FileSystemHandle, string>();

function projectRoot(identity: string) {
  const handle = {
    name: "Session",
    isSameEntry: vi.fn(async (other: FileSystemHandle) => rootIdentities.get(other) === identity),
    resolve: vi.fn<FileSystemDirectoryHandle["resolve"]>(async () => null),
  } as unknown as FileSystemDirectoryHandle;
  rootIdentities.set(handle, identity);
  return handle;
}

function projectRecent(id: string, rootHandle: FileSystemDirectoryHandle, lastOpened = 0): RecentScore {
  return {
    id,
    scoreName: `${id}.mnx`,
    fileHandle: { name: `${id}.mnx` } as FileSystemFileHandle,
    lastOpened,
    vcs: { rootHandle, rootName: rootHandle.name, scoreRelPath: `${id}.mnx` },
  };
}

describe("recent project identity", () => {
  it("keeps one folder entry with its latest selected score, even for overlapping updates", async () => {
    const records = storedRecents();
    const first = projectRecent("one", projectRoot("session"));
    const second = projectRecent("two", projectRoot("session"));

    const [openedFirst, openedSecond] = await Promise.all([
      rememberScore({ ...first, id: undefined }),
      rememberScore({ ...second, id: undefined }),
    ]);

    expect(openedSecond.id).toBe(openedFirst.id);
    expect(await listRecentScores()).toEqual([openedSecond]);
    expect(openedSecond.vcs?.scoreRelPath).toBe("two.mnx");
    expect(records.size).toBe(1);
  });

  it("consolidates existing per-score folder entries and does not resurrect them after removal", async () => {
    const older = projectRecent("one", projectRoot("session"), 1);
    const newer = projectRecent("two", projectRoot("session"), 2);
    const records = storedRecents([older, newer]);

    expect(await listRecentScores()).toEqual([newer]);
    expect(records.size).toBe(1);
    await forgetScore(newer.id);
    expect(await listRecentScores()).toEqual([]);
  });

  it("does not merge different folders with the same name or an unrelated standalone file", async () => {
    storedRecents();
    const first = projectRecent("score", projectRoot("first"));
    const second = projectRecent("score", projectRoot("second"));
    const standalone = { scoreName: "score.mnx", fileHandle: {} as FileSystemFileHandle };

    const openedFirst = await rememberScore({ ...first, id: undefined });
    const openedSecond = await rememberScore({ ...second, id: undefined });
    const openedFile = await rememberScore(standalone);

    expect(new Set([openedFirst.id, openedSecond.id, openedFile.id]).size).toBe(3);
    expect(await listRecentScores()).toHaveLength(3);
  });

  it("absorbs older file recents inside an opened folder while preserving files elsewhere", async () => {
    const root = projectRoot("session");
    const first = { ...projectRecent("one", root, 1), vcs: undefined };
    const second = { ...projectRecent("two", root, 2), vcs: undefined };
    const outside = { ...projectRecent("outside", root, 3), vcs: undefined };
    const records = storedRecents([first, second, outside]);
    vi.mocked(root.resolve).mockImplementation(async (handle) =>
      handle === first.fileHandle || handle === second.fileHandle ? [handle.name] : null,
    );
    const active = projectRecent("one", root);

    const opened = await rememberScore({ ...active, id: undefined, vcs: { ...active.vcs!, versioned: false } });

    expect(opened.vcs).toMatchObject({ rootName: "Session", scoreRelPath: "one.mnx", versioned: false });
    expect(await listRecentScores()).toEqual([opened, outside]);
    expect(records.size).toBe(2);
  });

  it("keeps saved projects accessible if handle comparisons stall", async () => {
    vi.useFakeTimers();
    const first = projectRecent("one", projectRoot("first"), 3);
    const second = projectRecent("two", projectRoot("second"), 2);
    const third = projectRecent("three", projectRoot("third"), 1);
    vi.mocked(first.vcs!.rootHandle.isSameEntry).mockReturnValue(new Promise(() => {}));
    storedRecents([first, second, third]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const listing = listRecentScores();
    await vi.advanceTimersByTimeAsync(1100);

    expect(await listing).toEqual([first, second, third]);
    expect(warning).toHaveBeenCalledWith("Could not compare recent locations:", expect.any(Error));
  });
});

describe("saved-location permissions", () => {
  it("bounds a stalled query without requesting permission or accepting a late result", async () => {
    vi.useFakeTimers();
    let finish!: (value: PermissionState) => void;
    const request = vi.fn();
    const entry = recent(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      request,
    );
    const result = ensureScorePermission(entry);
    const rejected = expect(result).rejects.toBeInstanceOf(RecentScorePermissionTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    finish("granted");
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stalled interactive request", async () => {
    vi.useFakeTimers();
    const entry = recent(
      async () => "prompt",
      vi.fn(() => new Promise<PermissionState>(() => {})),
    );
    const result = ensureScorePermission(entry);
    const rejected = expect(result).rejects.toBeInstanceOf(RecentScorePermissionTimeoutError);
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["granted", "denied"] as const)("preserves a %s permission response and clears timers", async (state) => {
    vi.useFakeTimers();
    const request = vi.fn(async () => state);
    await expect(ensureScorePermission(recent(async () => "prompt", request))).resolves.toBe(state === "granted");
    expect(request).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

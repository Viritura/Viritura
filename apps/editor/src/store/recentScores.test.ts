import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureScorePermission, RecentScorePermissionTimeoutError, type RecentScore } from "./recentScores";

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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitProjectAdapter, openRepo } from "../git";
import { InMemoryFs } from "../git/fs/inMemoryFs";
import { bootProjectFromHandle, useProjectStore } from "./projectStore";
import { listRecentScores, rememberScore, type RecentScore } from "./recentScores";
import { useOnboardingStore } from "./onboardingStore";

vi.mock("../git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git")>()),
  openRepo: vi.fn(),
}));
vi.mock("./recentScores", () => ({ rememberScore: vi.fn(), listRecentScores: vi.fn(async () => []) }));

const JSON_SCORE = '{"mnx":{"version":1},"global":{"measures":[]},"parts":[]}';
const fileHandle = { name: "score.mnx" } as FileSystemFileHandle;
const rootHandle = {
  name: "Project",
  getFileHandle: vi.fn(async () => fileHandle),
} as FileSystemDirectoryHandle;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(rememberScore).mockReset();
  vi.mocked(listRecentScores).mockReset().mockResolvedValue([]);
  useProjectStore.setState({ adapter: null, projectFolder: null, projectDiskBaseline: null });
  useOnboardingStore.setState({ recentScores: [] });
});

function prepareAdapter() {
  const adapter = new GitProjectAdapter({ fs: new InMemoryFs(), name: "Project", scorePath: "score.mnx" });
  vi.spyOn(adapter, "readScore").mockResolvedValue(JSON_SCORE);
  vi.spyOn(adapter, "status").mockResolvedValue({
    mode: "project",
    name: "Project",
    dirty: false,
    branch: "main",
    remoteUrl: null,
    aheadCount: null,
    behindCount: null,
    commitCount: 0,
  });
  vi.spyOn(adapter, "log").mockResolvedValue([]);
  vi.mocked(openRepo).mockResolvedValue(adapter);
  return adapter;
}

describe("project opening bookkeeping", () => {
  it("opens without waiting for a stalled recent-handle comparison and updates recents when it finishes", async () => {
    const adapter = prepareAdapter();
    let finishRemembering!: (entry: RecentScore) => void;
    vi.mocked(rememberScore).mockReturnValue(
      new Promise((resolve) => {
        finishRemembering = resolve;
      }),
    );

    await expect(bootProjectFromHandle({ rootHandle, scorePath: "score.mnx" })).resolves.toBe(adapter);
    expect(useProjectStore.getState()).toMatchObject({
      adapter,
      projectFolder: rootHandle,
      projectDiskBaseline: JSON_SCORE,
    });
    await vi.waitFor(() => expect(rememberScore).toHaveBeenCalledOnce());
    expect(useOnboardingStore.getState().recentScores).toEqual([]);
    const entry: RecentScore = {
      id: "project",
      scoreName: "score.mnx",
      lastOpened: 1,
      fileHandle,
      vcs: { rootHandle, rootName: "Project", scoreRelPath: "score.mnx" },
    };
    const otherEntry = { ...entry, id: "other" };
    useOnboardingStore.setState({
      recentScores: [{ ...entry, lastOpened: 0 }, { ...entry, id: "previous-score" }, otherEntry],
    });
    vi.mocked(listRecentScores).mockResolvedValue([entry, otherEntry]);
    finishRemembering(entry);
    await vi.waitFor(() => expect(useOnboardingStore.getState().recentScores).toEqual([entry, otherEntry]));
  }, 1500);

  it("reports failed recent persistence without failing project opening", async () => {
    const adapter = prepareAdapter();
    const error = new Error("Recent storage failed");
    vi.mocked(rememberScore).mockRejectedValue(error);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(bootProjectFromHandle({ rootHandle, scorePath: "score.mnx" })).resolves.toBe(adapter);
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith("Failed to record recent project score:", error));
    expect(useProjectStore.getState().adapter).toBe(adapter);
  });

  it("validates the target file before replacing the active project", async () => {
    const previous = prepareAdapter();
    useProjectStore.setState({ adapter: previous, projectFolder: rootHandle });
    const target = prepareAdapter();
    const failure = new Error("Invalid score");

    await expect(
      bootProjectFromHandle({
        rootHandle,
        scorePath: "score.mnx",
        validateScore: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(useProjectStore.getState().adapter).toBe(previous);
    expect(useProjectStore.getState().adapter).not.toBe(target);
    expect(rememberScore).not.toHaveBeenCalled();
  });

  it("loads the validated score before waiting for project status", async () => {
    const adapter = prepareAdapter();
    const status = await adapter.status();
    let finishStatus!: (status: typeof status) => void;
    vi.mocked(adapter.status).mockReturnValue(
      new Promise((resolve) => {
        finishStatus = resolve;
      }),
    );
    const onActivated = vi.fn();
    const opening = bootProjectFromHandle({ rootHandle, scorePath: "score.mnx", onActivated });

    await vi.waitFor(() => expect(onActivated).toHaveBeenCalledOnce());
    expect(useProjectStore.getState()).toMatchObject({
      adapter,
      projectFolder: rootHandle,
      projectDiskBaseline: JSON_SCORE,
      activeScorePath: "score.mnx",
    });
    finishStatus(status);
    await expect(opening).resolves.toBe(adapter);
  });

  it("does not publish stale status from a previously active adapter", async () => {
    const first = prepareAdapter();
    const firstStatus = await first.status();
    let finishFirstStatus!: (status: typeof firstStatus) => void;
    vi.mocked(first.status).mockReturnValue(
      new Promise((resolve) => {
        finishFirstStatus = resolve;
      }),
    );
    const refresh = useProjectStore.getState().setAdapter(first, rootHandle);
    const second = prepareAdapter();
    vi.mocked(second.status).mockResolvedValue({ ...firstStatus, name: "Second" });
    await useProjectStore.getState().setAdapter(second, rootHandle);

    finishFirstStatus(firstStatus);
    await refresh;
    expect(useProjectStore.getState().adapter).toBe(second);
    expect(useProjectStore.getState().status?.name).toBe("Second");
  });

  it("does not overwrite a newer refresh of the same project", async () => {
    const adapter = prepareAdapter();
    const oldStatus = await adapter.status();
    let finishOldStatus!: (status: typeof oldStatus) => void;
    vi.mocked(adapter.status)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOldStatus = resolve;
        }),
      )
      .mockResolvedValue({ ...oldStatus, name: "Updated" });

    const oldRefresh = useProjectStore.getState().setAdapter(adapter, rootHandle);
    await useProjectStore.getState().refresh();
    finishOldStatus(oldStatus);
    await oldRefresh;
    expect(useProjectStore.getState().status?.name).toBe("Updated");
  });
});

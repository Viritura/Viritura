import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitProjectAdapter, openRepo } from "../git";
import { InMemoryFs } from "../git/fs/inMemoryFs";
import { bootProjectFromHandle, useProjectStore } from "./projectStore";
import { rememberScore, type RecentScore } from "./recentScores";
import { useOnboardingStore } from "./onboardingStore";

vi.mock("../git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git")>()),
  openRepo: vi.fn(),
}));
vi.mock("./recentScores", () => ({ rememberScore: vi.fn() }));

const JSON_SCORE = '{"mnx":{"version":1},"global":{"measures":[]},"parts":[]}';
const fileHandle = { name: "score.mnx" } as FileSystemFileHandle;
const rootHandle = {
  name: "Project",
  getFileHandle: vi.fn(async () => fileHandle),
} as FileSystemDirectoryHandle;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(rememberScore).mockReset();
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
    useOnboardingStore.setState({ recentScores: [{ ...entry, lastOpened: 0 }, otherEntry] });
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
});

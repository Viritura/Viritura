import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import { openFolderConfirm } from "../store/modalFlowStore";
import { bootProjectFromHandle } from "../store/projectStore";
import { scanForMnxFiles } from "../store/folderScan";
import { directoryHasEntry } from "./fsHelpers";
import { useFolderOpen, type FolderOpenDeps } from "./useFolderOpen";

const mocks = vi.hoisted(() => ({
  setAdapter: vi.fn(),
  setProjectScores: vi.fn(),
  setProjectDiskBaseline: vi.fn(),
  readScore: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@viritura/format", () => ({ parseMnx: vi.fn() }));
vi.mock("../commands/fileCommands", () => ({ validateMnxJson: vi.fn(() => null) }));
vi.mock("../store/modalFlowStore", () => ({ openFolderConfirm: vi.fn() }));
vi.mock("../store/dialogStore", () => ({ openDialog: vi.fn() }));
vi.mock("../store/onboardingStore", () => ({ setRecentScores: vi.fn(), setTrackBannerFile: vi.fn() }));
vi.mock("../store/recentScores", () => ({
  listRecentScores: vi.fn(async () => []),
  rememberScore: vi.fn(async () => undefined),
}));
vi.mock("../store/folderScan", () => ({
  scanForMnxFiles: vi.fn(),
  pickDefaultScore: vi.fn(),
}));
vi.mock("./fsHelpers", () => ({ directoryHasEntry: vi.fn() }));
vi.mock("../store/projectStore", () => ({
  bootProjectFromHandle: vi.fn(),
  resolveFileHandle: vi.fn(),
  useProjectStore: {
    getState: () => ({
      setAdapter: mocks.setAdapter,
      setProjectScores: mocks.setProjectScores,
      setProjectDiskBaseline: mocks.setProjectDiskBaseline,
    }),
  },
}));

const json = '{"mnx":{"version":1}}';
const root = { name: "Session" } as FileSystemDirectoryHandle;
const handle = {
  getFile: async () => ({ name: "one.mnx", text: async () => json }),
} as FileSystemFileHandle;
const scores = [{ name: "one.mnx", relativePath: "one.mnx", handle }];

function harness() {
  const deps: FolderOpenDeps = {
    store: { getState: () => ({ mnxJson: json }) } as FolderOpenDeps["store"],
    loadScore: vi.fn(),
    resetHistory: vi.fn(),
    setSelectedScoreIndex: vi.fn(),
    setFileHandle: vi.fn(),
    setOpenedFile: vi.fn(),
    setFileError: vi.fn(),
    canSetUpGitHubRepository: false,
  };
  const { result } = renderHook(() => useFolderOpen(deps));
  const open = async () => {
    await act(async () => result.current.openFolderHandle(root));
  };
  return { deps, open };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(directoryHasEntry).mockResolvedValue(false);
  vi.mocked(scanForMnxFiles).mockResolvedValue(scores);
  mocks.readScore.mockResolvedValue(json);
  vi.mocked(bootProjectFromHandle).mockResolvedValue({
    readScore: mocks.readScore,
  } as unknown as Awaited<ReturnType<typeof bootProjectFromHandle>>);
});

it("offers initialization when opening a folder without Git through the default entry point", async () => {
  vi.mocked(openFolderConfirm).mockResolvedValue("init");
  const { open, deps } = harness();
  await open();

  expect(openFolderConfirm).toHaveBeenCalledWith("Session", 1);
  expect(bootProjectFromHandle).toHaveBeenCalledWith({
    rootHandle: root,
    scorePath: "one.mnx",
    scores,
    init: { initialJson: json, initialMessage: "Initial draft" },
  });
  expect(deps.loadScore).toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("opens without initializing when the user chooses a plain folder", async () => {
  vi.mocked(openFolderConfirm).mockResolvedValue("plain");
  const { open, deps } = harness();
  await open();

  expect(bootProjectFromHandle).not.toHaveBeenCalled();
  expect(mocks.setProjectScores).toHaveBeenCalledWith(root, scores, "one.mnx");
  expect(deps.setOpenedFile).toHaveBeenCalledWith({ mnxJson: json, filename: "one.mnx", fileHandle: handle });
});

it("leaves the document and project untouched when initialization is cancelled", async () => {
  vi.mocked(openFolderConfirm).mockResolvedValue(null);
  const { open, deps } = harness();
  await open();

  expect(bootProjectFromHandle).not.toHaveBeenCalled();
  expect(mocks.setAdapter).not.toHaveBeenCalled();
  expect(deps.loadScore).not.toHaveBeenCalled();
  expect(deps.setOpenedFile).not.toHaveBeenCalled();
});

it("opens an existing repository without offering to initialize it again", async () => {
  vi.mocked(directoryHasEntry).mockResolvedValue(true);
  const { open } = harness();
  await open();

  expect(openFolderConfirm).not.toHaveBeenCalled();
  expect(bootProjectFromHandle).toHaveBeenCalledWith({
    rootHandle: root,
    scorePath: "one.mnx",
    scores,
  });
  expect(parseMnx).toHaveBeenCalled();
});

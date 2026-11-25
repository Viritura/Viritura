import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { parseMnx } from "@viritura/format";
import { validateMnxJson } from "../commands/fileCommands";
import { openFolderConfirm } from "../store/modalFlowStore";
import { bootProjectFromHandle, resolveFileHandle } from "../store/projectStore";
import { scanForMnxFiles } from "../store/folderScan";
import { useLiveSessionStore } from "../live/liveSessionStore";
import { directoryHasEntry } from "./fsHelpers";
import { useFolderOpen, type FolderOpenDeps } from "./useFolderOpen";

const mocks = vi.hoisted(() => ({
  setAdapter: vi.fn(),
  setProjectScores: vi.fn(),
  setProjectDiskBaseline: vi.fn(),
  readScore: vi.fn<() => Promise<string>>(),
  adapter: null as { isVersioned: () => boolean } | null,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@viritura/format", () => ({ parseMnx: vi.fn() }));
vi.mock("../commands/fileCommands", () => ({
  validateMnxJson: vi.fn(() => null),
  recoverImportedMnx: vi.fn((mnxJson: string) => ({ mnxJson, recovered: [], error: null })),
}));
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
      projectFolder: root,
      projectScores: scores,
      adapter: mocks.adapter,
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
  const documentState = { mnxJson: json, documentGeneration: 1, scoreRevision: "initial" };
  const deps: FolderOpenDeps = {
    store: { getState: () => documentState } as FolderOpenDeps["store"],
    loadScore: vi.fn(),
    resetHistory: vi.fn(),
    loadOpenedFile: vi.fn(() => true),
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
  return { deps, open, result, documentState };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(directoryHasEntry).mockResolvedValue(false);
  vi.mocked(scanForMnxFiles).mockResolvedValue(scores);
  vi.mocked(resolveFileHandle).mockResolvedValue(handle);
  useLiveSessionStore.setState({ status: "idle" });
  mocks.adapter = null;
  mocks.readScore.mockResolvedValue(json);
  vi.mocked(bootProjectFromHandle).mockImplementation(async (options) => {
    options.validateScore?.(await mocks.readScore());
    options.onActivated?.();
    return {
      readScore: mocks.readScore,
    } as unknown as Awaited<ReturnType<typeof bootProjectFromHandle>>;
  });
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
    validateScore: expect.any(Function),
    onActivated: expect.any(Function),
    init: { initialJson: json, initialMessage: "Initial draft", preserveExistingScore: true },
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
  expect(deps.loadOpenedFile).toHaveBeenCalledWith({ mnxJson: json, filename: "one.mnx", fileHandle: handle });
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
    validateScore: expect.any(Function),
    onActivated: expect.any(Function),
  });
  expect(parseMnx).toHaveBeenCalled();
});

it.each(["plain", "versioned"])("does not replace the active %s score with invalid MNX", async (mode) => {
  mocks.adapter = mode === "versioned" ? { isVersioned: () => true } : null;
  vi.mocked(parseMnx).mockImplementation(() => {
    throw new Error("Invalid score structure");
  });
  const { result, deps } = harness();

  let opened = true;
  await act(async () => {
    opened = await result.current.openProjectScore("one.mnx");
  });
  expect(opened).toBe(false);
  expect(bootProjectFromHandle).not.toHaveBeenCalled();
  expect(mocks.setAdapter).not.toHaveBeenCalled();
  expect(deps.setOpenedFile).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

it("does not replace edits made while reading another project score", async () => {
  let resolveHandle!: (handle: FileSystemFileHandle) => void;
  vi.mocked(resolveFileHandle).mockReturnValue(
    new Promise((resolve) => {
      resolveHandle = resolve;
    }),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { result, deps, documentState } = harness();
  const pending = result.current.openProjectScore("one.mnx");
  documentState.scoreRevision = "edited";
  await act(async () => resolveHandle(handle));

  await expect(pending).resolves.toBe(false);
  expect(deps.setOpenedFile).not.toHaveBeenCalled();
  expect(mocks.setAdapter).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
  error.mockRestore();
});

it("revalidates project score contents that changed during opening", async () => {
  mocks.adapter = { isVersioned: () => true };
  mocks.readScore.mockResolvedValue('{"changed":true}');
  vi.mocked(validateMnxJson).mockReturnValueOnce(null).mockReturnValueOnce("Missing MNX version");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { result, deps } = harness();

  await act(async () => expect(await result.current.openProjectScore("one.mnx")).toBe(false));
  expect(deps.loadScore).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Failed to open one.mnx", {
    description: "Invalid MNX: Missing MNX version",
  });
  error.mockRestore();
});

it("does not switch if a live session starts while reading the target", async () => {
  let resolveHandle!: (handle: FileSystemFileHandle) => void;
  vi.mocked(resolveFileHandle).mockReturnValue(
    new Promise((resolve) => {
      resolveHandle = resolve;
    }),
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { result, deps } = harness();
  const pending = result.current.openProjectScore("one.mnx");
  useLiveSessionStore.setState({ status: "active" });
  await act(async () => resolveHandle(handle));

  await expect(pending).resolves.toBe(false);
  expect(deps.setOpenedFile).not.toHaveBeenCalled();
  expect(mocks.setAdapter).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
  error.mockRestore();
});

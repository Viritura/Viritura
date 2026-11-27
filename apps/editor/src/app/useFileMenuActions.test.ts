import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileMenuActions, type FileMenuDeps } from "./useFileMenuActions";
import { createDocumentStore } from "../store/documentStore";
import { useProjectStore } from "../store/projectStore";
import { useOnboardingStore } from "../store/onboardingStore";
import {
  ensureScorePermission,
  rememberScore,
  RecentScorePermissionTimeoutError,
  type RecentScore,
} from "../store/recentScores";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../store/recentScores", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../store/recentScores")>()),
  rememberScore: vi.fn(async () => ({ id: "launched-score" })),
  ensureScorePermission: vi.fn(),
  forgetScore: vi.fn(),
  listRecentScores: vi.fn(),
}));

function mount() {
  const deps: FileMenuDeps = {
    store: createDocumentStore(),
    loadDefaultScore: vi.fn(),
    loadSampleScore: vi.fn(),
    handleOpenProject: vi.fn(),
    openFolderHandle: vi.fn(),
    setOpenedFile: vi.fn(),
    setFileError: vi.fn(),
    suppressTrackBanner: true,
    onChooseProjectLocation: vi.fn(),
    onNewScore: vi.fn(),
  };
  const hook = renderHook(() => useFileMenuActions(deps));
  return { deps, ...hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ adapter: null });
  useOnboardingStore.setState({ startCenterOpen: true, recentScores: [] });
});

describe("shared validated MNX opening", () => {
  it.each([
    { opened: true, versioned: undefined },
    { opened: false, versioned: undefined },
    { opened: true, versioned: false },
    { opened: false, versioned: false },
  ])(
    "reopens a recent as a folder and closes the Start Center only on success ($opened, $versioned)",
    async ({ opened, versioned }) => {
      const { deps, result } = mount();
      const rootHandle = { name: "Session" } as FileSystemDirectoryHandle;
      vi.mocked(ensureScorePermission).mockResolvedValue(true);
      vi.mocked(deps.openFolderHandle).mockResolvedValue(opened);
      const entry: RecentScore = {
        id: "session",
        scoreName: "two.mnx",
        lastOpened: 0,
        fileHandle: {} as FileSystemFileHandle,
        vcs: { rootHandle, rootName: "Session", scoreRelPath: "two.mnx", versioned },
      };

      await result.current.handleSelectRecent(entry);

      expect(deps.openFolderHandle).toHaveBeenCalledWith(rootHandle, {
        scorePath: "two.mnx",
        unversioned: versioned === false,
      });
      expect(deps.setOpenedFile).not.toHaveBeenCalled();
      expect(useOnboardingStore.getState().startCenterOpen).toBe(!opened);
    },
  );

  it("offers a fresh folder picker when a recent project's permission check stalls", async () => {
    const { deps, result } = mount();
    const entry: RecentScore = {
      id: "project",
      scoreName: "score.mnx",
      lastOpened: 0,
      fileHandle: {} as FileSystemFileHandle,
      vcs: {
        rootHandle: {} as FileSystemDirectoryHandle,
        rootName: "Project",
        scoreRelPath: "score.mnx",
      },
    };
    const error = new RecentScorePermissionTimeoutError();
    vi.mocked(ensureScorePermission).mockRejectedValueOnce(error);
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});

    await result.current.handleSelectRecent(entry);

    expect(deps.openFolderHandle).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().startCenterOpen).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(error.message, {
      duration: Infinity,
      action: { label: "Choose folder again", onClick: expect.any(Function) },
    });
    const options = vi.mocked(toast.error).mock.calls.at(-1)?.[1];
    if (!options?.action || typeof options.action !== "object" || !("onClick" in options.action)) {
      throw new Error("Missing picker recovery action");
    }
    options.action.onClick({} as React.MouseEvent<HTMLButtonElement>);
    expect(deps.handleOpenProject).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("opens a launched document, preserves its save handle, and remembers it", async () => {
    const { deps, result } = mount();
    const handle = { name: "score.mnx" } as FileSystemFileHandle;
    const opened = {
      filename: "score.mnx",
      mnxJson: readFileSync(resolve(__dirname, "../../../../packages/format/fixtures/mnx/hello-world.mnx"), "utf8"),
      fileHandle: handle,
    };
    expect(await result.current.handleOpenFileResult(opened)).toBe(true);
    expect(deps.setOpenedFile).toHaveBeenCalledExactlyOnceWith(opened);
    expect(rememberScore).toHaveBeenCalledWith({ scoreName: "score.mnx", fileHandle: handle });
    expect(useOnboardingStore.getState().startCenterOpen).toBe(false);
  });

  it("leaves the active project and document untouched when schema validation fails", async () => {
    const { deps, result } = mount();
    const setAdapter = vi.spyOn(useProjectStore.getState(), "setAdapter");
    expect(
      await result.current.handleOpenFileResult({
        filename: "bad.mnx",
        mnxJson: "{}",
        fileHandle: null,
      }),
    ).toBe(false);
    expect(deps.setFileError).toHaveBeenCalledWith(expect.stringContaining("bad.mnx:"));
    expect(deps.setOpenedFile).not.toHaveBeenCalled();
    expect(setAdapter).not.toHaveBeenCalled();
    expect(rememberScore).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().startCenterOpen).toBe(true);
    setAdapter.mockRestore();
  });
});

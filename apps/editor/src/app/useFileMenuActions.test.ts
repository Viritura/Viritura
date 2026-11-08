import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileMenuActions, type FileMenuDeps } from "./useFileMenuActions";
import { createDocumentStore } from "../store/documentStore";
import { useProjectStore } from "../store/projectStore";
import { useOnboardingStore } from "../store/onboardingStore";
import { rememberScore } from "../store/recentScores";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../store/recentScores", () => ({
  rememberScore: vi.fn(async () => ({ id: "launched-score" })),
  ensureScorePermission: vi.fn(),
  forgetScore: vi.fn(),
  listRecentScores: vi.fn(),
}));

function mount() {
  const deps: FileMenuDeps = {
    store: createDocumentStore(),
    loadScore: vi.fn(),
    resetHistory: vi.fn(),
    loadDefaultScore: vi.fn(),
    loadSampleScore: vi.fn(),
    handleOpenProject: vi.fn(),
    setSelectedScoreIndex: vi.fn(),
    setFileHandle: vi.fn(),
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

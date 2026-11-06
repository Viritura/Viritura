import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileSaveActions } from "./useFileSaveActions";

const fileSaveAs = vi.hoisted(() => vi.fn());
const fileDownload = vi.hoisted(() => vi.fn());
const isFileSystemAccessSupported = vi.hoisted(() => vi.fn());
vi.mock("../commands/fileCommands", () => ({
  fileSaveAs,
  fileDownload,
  isFileSystemAccessSupported,
}));

const openExternalChangeConfirm = vi.fn();
const commitCurrent = vi.fn().mockResolvedValue("commit-sha");
const toastError = vi.hoisted(() => vi.fn());
const projectState: {
  adapter: null | {
    isVersioned: () => boolean;
    readScore: () => Promise<string>;
    writeScore: (json: string) => Promise<void>;
  };
  commitCurrent: typeof commitCurrent;
} = { adapter: null, commitCurrent };

vi.mock("../store/modalFlowStore", () => ({
  openExternalChangeConfirm: (...args: unknown[]) => openExternalChangeConfirm(...args),
}));

vi.mock("../store/projectStore", () => ({
  useProjectStore: { getState: () => projectState },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError },
}));

const DISK_JSON = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [] },
  parts: [],
});
const EDITOR_JSON = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [] },
  parts: [],
  scores: [],
});
const EXTERNAL_JSON = JSON.stringify({
  mnx: { version: 1 },
  global: { measures: [] },
  parts: [],
  layouts: [],
});

function createHarness(diskJson = DISK_JSON, hasFileHandle = true) {
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const getFile = vi.fn().mockImplementation(async () => new File([diskJson], "score.mnx"));
  const fileHandle = {
    getFile,
    createWritable: vi.fn().mockResolvedValue({ write, close }),
  } as unknown as FileSystemFileHandle;
  const loadScore = vi.fn();
  const markSaved = vi.fn();
  const state = {
    mnxJson: EDITOR_JSON,
    fileName: "score.mnx",
    loadScore,
    documentGeneration: 1,
    markSaved,
  };
  const store = { getState: () => state } as never;
  const resetHistory = vi.fn();
  const setFileHandle = vi.fn();
  const openedFile = { mnxJson: DISK_JSON, filename: "score.mnx", fileHandle };
  const hook = renderHook(() =>
    useFileSaveActions({
      store,
      fileHandle: hasFileHandle ? fileHandle : null,
      setFileHandle,
      openedFile,
      resetHistory,
    }),
  );
  return { ...hook, write, close, getFile, loadScore, resetHistory, markSaved, state, fileHandle };
}

describe("useFileSaveActions external changes", () => {
  beforeEach(() => {
    openExternalChangeConfirm.mockReset();
    commitCurrent.mockClear();
    commitCurrent.mockResolvedValue("commit-sha");
    toastError.mockClear();
    projectState.adapter = null;
    fileSaveAs.mockReset();
    fileDownload.mockReset();
    isFileSystemAccessSupported.mockReturnValue(true);
  });

  it("saves without prompting when the disk version matches the baseline", async () => {
    const { result, write, markSaved } = createHarness();

    await act(() => result.current.handleSave());

    expect(openExternalChangeConfirm).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(EDITOR_JSON);
    expect(markSaved).toHaveBeenCalledWith(EDITOR_JSON, 1);
  });

  it("cancels without writing when external changes are detected", async () => {
    openExternalChangeConfirm.mockResolvedValue(null);
    const { result, write, markSaved } = createHarness(EXTERNAL_JSON);

    await act(() => result.current.handleSave());

    expect(openExternalChangeConfirm).toHaveBeenCalledWith("score.mnx");
    expect(write).not.toHaveBeenCalled();
    expect(markSaved).not.toHaveBeenCalled();
  });

  it("overwrites the external version only after confirmation", async () => {
    openExternalChangeConfirm.mockResolvedValue("overwrite");
    const { result, write } = createHarness(EXTERNAL_JSON);

    await act(() => result.current.handleSave());

    expect(write).toHaveBeenCalledWith(EDITOR_JSON);
  });

  it("reloads the external version and discards in-app changes", async () => {
    openExternalChangeConfirm.mockResolvedValue("reload");
    const { result, write, loadScore, resetHistory } = createHarness(EXTERNAL_JSON);

    await act(() => result.current.handleSave());

    expect(write).not.toHaveBeenCalled();
    expect(loadScore).toHaveBeenCalledWith(expect.any(Object), "score.mnx", EXTERNAL_JSON);
    expect(resetHistory).toHaveBeenCalled();
  });

  it("checks a Git project working tree before writing and committing", async () => {
    openExternalChangeConfirm.mockResolvedValue("overwrite");
    const readScore = vi.fn().mockResolvedValue(EXTERNAL_JSON);
    const writeScore = vi.fn().mockResolvedValue(undefined);
    projectState.adapter = { isVersioned: () => true, readScore, writeScore };
    const { result, markSaved } = createHarness();

    await act(() => result.current.handleSave());

    expect(readScore).toHaveBeenCalledOnce();
    expect(openExternalChangeConfirm).toHaveBeenCalledWith("score.mnx");
    expect(writeScore).toHaveBeenCalledOnce();
    expect(writeScore).toHaveBeenCalledWith(EDITOR_JSON);
    expect(commitCurrent).toHaveBeenCalledWith(EDITOR_JSON, { auto: false });
    expect(markSaved).toHaveBeenCalledWith(EDITOR_JSON, 1);
  });

  it("reports when the file saves but the background commit fails", async () => {
    const readScore = vi.fn().mockResolvedValue(DISK_JSON);
    const writeScore = vi.fn().mockResolvedValue(undefined);
    projectState.adapter = { isVersioned: () => true, readScore, writeScore };
    commitCurrent.mockRejectedValueOnce(new Error("Commit failed"));
    const { result } = createHarness();

    await act(() => result.current.handleSave());

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Saved, but version history could not be updated");
    });
  });

  it("does not mark a failed write as saved", async () => {
    const { result, write, markSaved } = createHarness();
    write.mockRejectedValueOnce(new Error("Disk full"));

    await act(() => result.current.handleSave());

    expect(markSaved).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Save failed");
  });

  it("does not mark a failed close as saved", async () => {
    const { result, close, markSaved } = createHarness();
    close.mockRejectedValueOnce(new Error("Disk full"));

    await act(() => result.current.handleSave());

    expect(markSaved).not.toHaveBeenCalled();
  });

  it("marks only the snapshot captured before an asynchronous save", async () => {
    const { result, write, markSaved, state } = createHarness();
    write.mockImplementationOnce(async () => {
      state.mnxJson = EXTERNAL_JSON;
      state.documentGeneration = 2;
    });

    await act(() => result.current.handleSave());

    expect(markSaved).toHaveBeenCalledWith(EDITOR_JSON, 1);
  });

  it.each(["handleSave", "handleSaveAs"] as const)("marks %s picker success as saved", async (action) => {
    const { result, markSaved, fileHandle } = createHarness(DISK_JSON, false);
    fileSaveAs.mockResolvedValueOnce(fileHandle);

    await act(() => result.current[action]());

    expect(markSaved).toHaveBeenCalledWith(EDITOR_JSON, 1);
  });

  it.each(["handleSave", "handleSaveAs"] as const)("keeps edits unsaved when %s is cancelled", async (action) => {
    const { result, markSaved } = createHarness(DISK_JSON, false);
    fileSaveAs.mockResolvedValueOnce(null);

    await act(() => result.current[action]());

    expect(markSaved).not.toHaveBeenCalled();
  });

  it.each(["handleSave", "handleSaveAs"] as const)("marks the %s download fallback as saved", async (action) => {
    const { result, markSaved } = createHarness(DISK_JSON, false);
    isFileSystemAccessSupported.mockReturnValue(false);
    fileSaveAs.mockResolvedValueOnce(null);

    await act(() => result.current[action]());

    expect(markSaved).toHaveBeenCalledWith(EDITOR_JSON, 1);
  });

  it("marks an explicit MNX download as saved", () => {
    const { result, markSaved } = createHarness();

    act(() => result.current.handleDownload());

    expect(fileDownload).toHaveBeenCalledWith(EDITOR_JSON, "score.mnx");
    expect(markSaved).toHaveBeenCalledWith(EDITOR_JSON, 1);
  });
});

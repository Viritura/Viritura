import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileSaveActions } from "./useFileSaveActions";

const openExternalChangeConfirm = vi.fn();
const commitCurrent = vi.fn().mockResolvedValue("commit-sha");
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
  toast: { success: vi.fn(), error: vi.fn() },
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

function createHarness(diskJson = DISK_JSON) {
  const write = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const getFile = vi.fn().mockImplementation(async () => new File([diskJson], "score.mnx"));
  const fileHandle = {
    getFile,
    createWritable: vi.fn().mockResolvedValue({ write, close }),
  } as unknown as FileSystemFileHandle;
  const loadScore = vi.fn();
  const state = {
    mnxJson: EDITOR_JSON,
    fileName: "score.mnx",
    loadScore,
  };
  const store = { getState: () => state } as never;
  const resetHistory = vi.fn();
  const setFileHandle = vi.fn();
  const openedFile = { mnxJson: DISK_JSON, filename: "score.mnx", fileHandle };
  const hook = renderHook(() => useFileSaveActions({ store, fileHandle, setFileHandle, openedFile, resetHistory }));
  return { ...hook, write, close, getFile, loadScore, resetHistory };
}

describe("useFileSaveActions external changes", () => {
  beforeEach(() => {
    openExternalChangeConfirm.mockReset();
    commitCurrent.mockClear();
    projectState.adapter = null;
  });

  it("saves without prompting when the disk version matches the baseline", async () => {
    const { result, write } = createHarness();

    await act(() => result.current.handleSave());

    expect(openExternalChangeConfirm).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(EDITOR_JSON);
  });

  it("cancels without writing when external changes are detected", async () => {
    openExternalChangeConfirm.mockResolvedValue(null);
    const { result, write } = createHarness(EXTERNAL_JSON);

    await act(() => result.current.handleSave());

    expect(openExternalChangeConfirm).toHaveBeenCalledWith("score.mnx");
    expect(write).not.toHaveBeenCalled();
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
    const { result } = createHarness();

    await act(() => result.current.handleSave());

    expect(readScore).toHaveBeenCalledOnce();
    expect(openExternalChangeConfirm).toHaveBeenCalledWith("score.mnx");
    expect(writeScore).toHaveBeenCalledOnce();
    expect(writeScore).toHaveBeenCalledWith(EDITOR_JSON);
    expect(commitCurrent).toHaveBeenCalledWith(EDITOR_JSON, { auto: false });
  });
});

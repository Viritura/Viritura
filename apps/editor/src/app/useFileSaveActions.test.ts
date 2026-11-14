import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileSaveActions } from "./useFileSaveActions";
import { CHORDS_PART_ID } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { getGlobalPerfTracker } from "@viritura/renderer";
import { createDocumentStore, hasUnsavedChanges } from "../store/documentStore";
import { changeDuration } from "../commands/changeDurationCommand";
import { bindMixerDocument } from "../store/mixerPersistence";
import { useMixerActions } from "../store/mixerStore";

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
  projectDiskBaseline: string | null;
  setProjectDiskBaseline: (adapter: NonNullable<typeof projectState.adapter>, json: string) => void;
  commitCurrent: typeof commitCurrent;
} = {
  adapter: null,
  projectDiskBaseline: null,
  setProjectDiskBaseline: (adapter, json) => {
    if (projectState.adapter === adapter) projectState.projectDiskBaseline = json;
  },
  commitCurrent,
};

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

function createHarness(diskJson = DISK_JSON, hasFileHandle = true, hasOpenedFile = true) {
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
      openedFile: hasOpenedFile ? openedFile : null,
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
    projectState.projectDiskBaseline = DISK_JSON;
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

  it.each(["handleSave", "handleSaveAs", "handleDownload"] as const)(
    "%s writes muted Chords from the real document store and restores them on reopen",
    async (action) => {
      const store = createDocumentStore();
      const unbind = bindMixerDocument(store);
      try {
        store.getState().loadScore(
          {
            mnx: { version: 1 },
            global: { measures: [{ chordSymbols: [{ position: { fraction: [0, 1] }, rawText: "C" }] }] },
            parts: [{ id: "flute", name: "Flute", measures: [{ sequences: [] }] }],
          },
          "score.mnx",
        );
        const baseline = store.getState().mnxJson;
        const { fileHandle, getFile, write } = createHarness();
        getFile.mockResolvedValueOnce(new File([baseline], "score.mnx"));
        fileSaveAs.mockResolvedValueOnce(fileHandle);
        const { result: mixer } = renderHook(useMixerActions);
        const { result } = renderHook(() =>
          useFileSaveActions({
            store,
            fileHandle,
            setFileHandle: vi.fn(),
            openedFile: { filename: "score.mnx", mnxJson: baseline, fileHandle },
            resetHistory: vi.fn(),
          }),
        );
        act(() => mixer.current.toggleMute(1));
        const expected = store.getState().mnxJson;
        await act(async () => {
          await result.current[action]();
        });
        const written =
          action === "handleSave"
            ? write.mock.calls[0]?.[0]
            : action === "handleSaveAs"
              ? fileSaveAs.mock.calls[0]?.[0]
              : fileDownload.mock.calls[0]?.[0];
        expect(written).toBe(expected);
        expect(store.getState().savedMnxJson).toBe(expected);
        const reopened = parseMnx(JSON.parse(expected));
        expect(reopened.mixer?.channels?.[CHORDS_PART_ID]?.muted).toBe(true);
        expect(reopened.parts).toHaveLength(1);
      } finally {
        unbind();
      }
    },
  );

  it.each([
    ["handleSave", false],
    ["handleSave", true],
    ["handleSaveAs", false],
    ["handleDownload", false],
  ] as const)("%s (versioned=%s) saves the latest rest edit while layout is pending", async (action, versioned) => {
    const store = createDocumentStore();
    store.getState().loadScore(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            name: "Piccolo",
            measures: [
              {
                sequences: [
                  {
                    content: [
                      { type: "event", duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 6 } }] },
                      { type: "event", id: "rest", duration: { base: "half", dots: 2 }, rest: {} },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      "score.mnx",
    );
    const baseline = store.getState().mnxJson;
    const { fileHandle, getFile, write } = createHarness();
    const writeScore = vi.fn().mockResolvedValue(undefined);
    if (versioned) {
      projectState.projectDiskBaseline = baseline;
      projectState.adapter = {
        isVersioned: () => true,
        readScore: vi.fn().mockResolvedValue(baseline),
        writeScore,
      };
    }
    getFile.mockResolvedValueOnce(new File([baseline], "score.mnx"));
    fileSaveAs.mockResolvedValueOnce(fileHandle);
    const { result } = renderHook(() =>
      useFileSaveActions({
        store,
        fileHandle,
        setFileHandle: vi.fn(),
        openedFile: { filename: "score.mnx", mnxJson: baseline, fileHandle },
        resetHistory: vi.fn(),
      }),
    );
    const perf = getGlobalPerfTracker();
    const previousCallback = perf.fastLayoutCallback;
    let finishLayout: (() => void) | undefined;
    perf.fastLayoutCallback = () =>
      new Promise<void>((resolve) => {
        finishLayout = resolve;
      });
    try {
      const edited = structuredClone(store.getState().workingScore!);
      changeDuration(edited, {
        partIndex: 0,
        measureIndex: 0,
        voice: 0,
        eventIndex: 1,
        newDuration: { base: "eighth" },
      });
      act(() => store.getState().updateScore(edited, { start: 0, end: 0 }));
      expect(store.getState().mnxJson).toBe(baseline);
      await act(async () => {
        await result.current[action]();
      });
      const written = versioned
        ? writeScore.mock.calls[0]?.[0]
        : action === "handleSave"
          ? write.mock.calls[0]?.[0]
          : action === "handleSaveAs"
            ? fileSaveAs.mock.calls[0]?.[0]
            : fileDownload.mock.calls[0]?.[0];
      const reopened = parseMnx(JSON.parse(written));
      const rest = reopened.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
      expect(rest.type === "event" && rest.duration).toEqual({ base: "eighth" });
      await act(async () => {
        finishLayout?.();
        await Promise.resolve();
      });
      await waitFor(() => expect(store.getState().score).toBe(store.getState().workingScore));
      expect(hasUnsavedChanges(store.getState())).toBe(false);
    } finally {
      finishLayout?.();
      perf.fastLayoutCallback = previousCallback;
    }
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

  it("detects an external project change on the first save without an opened file", async () => {
    const writeScore = vi.fn().mockResolvedValue(undefined);
    projectState.adapter = { isVersioned: () => true, readScore: vi.fn().mockResolvedValue(EXTERNAL_JSON), writeScore };
    openExternalChangeConfirm.mockResolvedValue(null);
    const { result } = createHarness(DISK_JSON, false, false);
    await act(() => result.current.handleSave());
    expect(openExternalChangeConfirm).toHaveBeenCalledWith("score.mnx");
    expect(writeScore).not.toHaveBeenCalled();
  });

  it("refuses a project save if its disk baseline is missing", async () => {
    const writeScore = vi.fn();
    projectState.adapter = { isVersioned: () => true, readScore: vi.fn().mockResolvedValue(DISK_JSON), writeScore };
    projectState.projectDiskBaseline = null;
    const { result } = createHarness(DISK_JSON, false, false);
    await act(() => result.current.handleSave());
    expect(writeScore).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Could not verify the project file's original contents");
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

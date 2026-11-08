import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBootSequence } from "./useBootSequence";
import { createDocumentStore } from "../store/documentStore";
import { useOnboardingStore } from "../store/onboardingStore";
import { listRecentScores } from "../store/recentScores";
import { useFileLaunch } from "../pwa";
import { setStartCenterOpen } from "../store/onboardingStore";
import type { OpenFileResult } from "../commands/fileCommands";

vi.mock("../store/recentScores", () => ({ listRecentScores: vi.fn(async () => []) }));

beforeEach(() => {
  vi.clearAllMocks();
  useOnboardingStore.setState({ startCenterOpen: false });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "launchQueue");
  window.history.replaceState({}, "", "/");
});

function mount(suppressStartCenter = false) {
  const loadDefaultScore = vi.fn();
  const store = createDocumentStore();
  renderHook(() =>
    useBootSequence({
      store,
      loadScore: vi.fn(),
      resetHistory: vi.fn(),
      setFileHandle: vi.fn(),
      loadDefaultScore,
      suppressStartCenter,
    }),
  );
  return loadDefaultScore;
}

describe("startup with OS-launched files", () => {
  it.each([false, true])(
    "shows a fallback without racing a default sample when launch data is absent (suppressed=%s)",
    async (suppressed) => {
      window.history.replaceState({}, "", "/?open-file=1");
      Object.defineProperty(window, "launchQueue", { configurable: true, value: {} });
      const loadDefaultScore = mount(suppressed);
      await Promise.resolve();
      expect(loadDefaultScore).not.toHaveBeenCalled();
      expect(listRecentScores).not.toHaveBeenCalled();
      expect(useOnboardingStore.getState().startCenterOpen).toBe(true);
    },
  );

  it("keeps the fallback visible until a genuinely delayed file is opened", async () => {
    window.history.replaceState({}, "", "/?open-file=1");
    let deliver!: (params: { files: FileSystemFileHandle[] }) => void;
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer: (callback: typeof deliver) => {
          deliver = callback;
        },
      },
    });
    const store = createDocumentStore();
    const loadDefaultScore = vi.fn();
    const handleOpenFileResult = vi.fn(async (_result: OpenFileResult) => {
      setStartCenterOpen(false);
      return true;
    });
    renderHook(() => {
      useBootSequence({
        store,
        loadScore: vi.fn(),
        resetHistory: vi.fn(),
        setFileHandle: vi.fn(),
        loadDefaultScore,
        suppressStartCenter: true,
      });
      useFileLaunch({ store, handleOpenFileResult, setFileError: vi.fn() });
    });
    expect(useOnboardingStore.getState().startCenterOpen).toBe(true);
    let finishRead!: (file: File) => void;
    const getFile = vi.fn(
      () =>
        new Promise<File>((done) => {
          finishRead = done;
        }),
    );
    const handle = { name: "delayed.mnx", getFile } as unknown as FileSystemFileHandle;
    await Promise.resolve();
    deliver({ files: [handle] });
    await waitFor(() => expect(getFile).toHaveBeenCalledTimes(1));
    expect(useOnboardingStore.getState().startCenterOpen).toBe(true);
    expect(loadDefaultScore).not.toHaveBeenCalled();
    finishRead(new File(["{}"], "delayed.mnx"));
    await waitFor(() => expect(handleOpenFileResult).toHaveBeenCalledTimes(1));
    expect(useOnboardingStore.getState().startCenterOpen).toBe(false);
    expect(loadDefaultScore).not.toHaveBeenCalled();
  });

  it("keeps ordinary startup behavior without a file launch", async () => {
    mount();
    await waitFor(() => expect(useOnboardingStore.getState().startCenterOpen).toBe(true));
    expect(listRecentScores).toHaveBeenCalled();
  });

  it("does not obscure a live-session guest with the launch fallback", async () => {
    window.history.replaceState({}, "", "/?open-file=1#live=abcd2345abcd2345");
    Object.defineProperty(window, "launchQueue", { configurable: true, value: {} });
    const loadDefaultScore = mount();
    await Promise.resolve();
    expect(useOnboardingStore.getState().startCenterOpen).toBe(false);
    expect(loadDefaultScore).not.toHaveBeenCalled();
    expect(listRecentScores).not.toHaveBeenCalled();
  });

  it("does not leave unsupported browsers on an empty launch page", async () => {
    window.history.replaceState({}, "", "/?open-file=1");
    mount();
    await waitFor(() => expect(useOnboardingStore.getState().startCenterOpen).toBe(true));
  });
});

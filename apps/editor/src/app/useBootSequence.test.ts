import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBootSequence } from "./useBootSequence";
import { createDocumentStore, SHARED_SETLIST_READ_ONLY } from "../store/documentStore";
import { useOnboardingStore } from "../store/onboardingStore";
import { listRecentScores } from "../store/recentScores";
import { useFileLaunch } from "../pwa";
import { setStartCenterOpen } from "../store/onboardingStore";
import type { OpenFileResult } from "../commands/fileCommands";
import { useGistSetlistStore } from "../gistShare";
import { toast } from "sonner";

vi.mock("../store/recentScores", () => ({ listRecentScores: vi.fn(async () => []) }));

beforeEach(() => {
  vi.clearAllMocks();
  useOnboardingStore.setState({ startCenterOpen: false });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useGistSetlistStore.getState().clear();
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
  it("opens a shared Gist setlist without showing the Start Center", async () => {
    const gistId = "0123456789abcdef0123456789abcdef";
    const revision = "0123456789abcdef0123456789abcdef01234567";
    const mnx = JSON.stringify({ mnx: { version: 1 }, global: { measures: [] }, parts: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: gistId,
              html_url: `https://gist.github.com/example/${gistId}`,
              history: [{ version: revision }],
              files: {
                "01 - score.mnx": {
                  filename: "01 - score.mnx",
                  content: mnx,
                  truncated: false,
                  raw_url: `https://gist.githubusercontent.com/example/${gistId}/raw/${revision}/score.mnx`,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    window.history.replaceState({}, "", `/?open=gist-setlist#id=${gistId}`);
    const store = createDocumentStore();
    const loadScore = vi.fn();
    const resetHistory = vi.fn();
    const setFileHandle = vi.fn();
    renderHook(() =>
      useBootSequence({
        store,
        loadScore,
        resetHistory,
        setFileHandle,
        loadDefaultScore: vi.fn(),
        suppressStartCenter: false,
      }),
    );

    await waitFor(() => expect(loadScore).toHaveBeenCalledOnce());
    expect(loadScore).toHaveBeenCalledWith(expect.any(Object), "01 - score.mnx", mnx);
    expect(useGistSetlistStore.getState().setlist?.files).toHaveLength(1);
    expect(useOnboardingStore.getState().startCenterOpen).toBe(false);
    expect(listRecentScores).not.toHaveBeenCalled();
    expect(setFileHandle).toHaveBeenCalledWith(null);
    expect(resetHistory).toHaveBeenCalledOnce();
    expect(store.getState().readOnlyReason).toBe(SHARED_SETLIST_READ_ONLY);
  });

  it("does not replace a score opened while the shared setlist is loading", async () => {
    const info = vi.spyOn(toast, "info");
    const gistId = "0123456789abcdef0123456789abcdef";
    const revision = "0123456789abcdef0123456789abcdef01234567";
    const mnx = JSON.stringify({ mnx: { version: 1 }, global: { measures: [] }, parts: [] });
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    window.history.replaceState({}, "", `/?open=gist-setlist#id=${gistId}`);
    const store = createDocumentStore();
    const loadScore = vi.fn();
    renderHook(() =>
      useBootSequence({
        store,
        loadScore,
        resetHistory: vi.fn(),
        setFileHandle: vi.fn(),
        loadDefaultScore: vi.fn(),
        suppressStartCenter: false,
      }),
    );
    store.setState({ documentGeneration: 1 });
    finish(
      new Response(
        JSON.stringify({
          id: gistId,
          html_url: `https://gist.github.com/example/${gistId}`,
          history: [{ version: revision }],
          files: {
            "score.mnx": {
              filename: "score.mnx",
              content: mnx,
              truncated: false,
              raw_url: `https://gist.githubusercontent.com/example/${gistId}/raw/${revision}/score.mnx`,
            },
          },
        }),
      ),
    );
    await waitFor(() => expect(info).toHaveBeenCalledWith("The open score changed while loading the shared setlist."));
    expect(loadScore).not.toHaveBeenCalled();
    expect(useGistSetlistStore.getState().setlist).toBeNull();
  });

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

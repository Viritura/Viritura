import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore } from "../store/documentStore";
import { useOnboardingStore } from "../store/onboardingStore";
import type { OpenFileResult } from "../commands/fileCommands";

vi.mock("../instrumentProfiles", () => ({ isDesktopHost: vi.fn(() => false) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

let deliver: (params: { files: FileSystemFileHandle[] }) => void;

function fileHandle(name = "score.mnx", json = "{}"): FileSystemFileHandle {
  return { name, getFile: vi.fn(async () => new File([json], name)) } as unknown as FileSystemFileHandle;
}

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/?open-file=1");
  useOnboardingStore.setState({ startCenterOpen: false });
  Object.defineProperty(window, "launchQueue", {
    configurable: true,
    value: {
      setConsumer: vi.fn((consumer) => {
        deliver = consumer;
      }),
    },
  });
  Object.defineProperty(window, "confirm", { configurable: true, writable: true, value: vi.fn(() => true) });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "launchQueue");
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

async function mount() {
  const { useFileLaunch } = await import("./useFileLaunch");
  const store = createDocumentStore();
  const handleOpenFileResult = vi.fn<(result: OpenFileResult) => Promise<boolean>>().mockResolvedValue(true);
  const setFileError = vi.fn();
  const hook = renderHook(() => useFileLaunch({ store, handleOpenFileResult, setFileError }));
  return { store, handleOpenFileResult, setFileError, ...hook };
}

describe("OS file launches", () => {
  it("preserves the supplied handle and opens an uppercase MNX exactly once under StrictMode", async () => {
    const { handleOpenFileResult } = await mount();
    const handle = fileHandle("SCORE.MNX", '{"mnx":{"version":46}}');
    deliver({ files: [handle] });
    await waitFor(() =>
      expect(handleOpenFileResult).toHaveBeenCalledExactlyOnceWith({
        filename: "SCORE.MNX",
        mnxJson: '{"mnx":{"version":46}}',
        fileHandle: handle,
      }),
    );
    expect(handle.getFile).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("");
  });

  it("does not discard files queued during effect teardown", async () => {
    const { handleOpenFileResult, unmount } = await mount();
    unmount();
    const handle = fileHandle();
    deliver({ files: [handle] });
    await Promise.resolve();
    expect(handleOpenFileResult).not.toHaveBeenCalled();
    const next = await mount();
    await waitFor(() => expect(next.handleOpenFileResult).toHaveBeenCalledTimes(1));
  });

  it.each(["score.mxn", "score.json", "score.exe"])("rejects an unregistered file type (%s)", async (name) => {
    const { handleOpenFileResult, setFileError } = await mount();
    const handle = fileHandle(name);
    deliver({ files: [handle] });
    await waitFor(() => expect(setFileError).toHaveBeenCalledWith("Please open an .mnx document."));
    expect(handleOpenFileResult).not.toHaveBeenCalled();
    expect(handle.getFile).not.toHaveBeenCalled();
  });

  it("reports unreadable files and restores the Start Center on a cold launch", async () => {
    const { handleOpenFileResult, setFileError } = await mount();
    const handle = fileHandle();
    vi.mocked(handle.getFile).mockRejectedValue(new Error("Permission denied"));
    deliver({ files: [handle] });
    await waitFor(() => expect(setFileError).toHaveBeenCalledWith("Permission denied"));
    expect(handleOpenFileResult).not.toHaveBeenCalled();
    // The hook imports its own store after resetModules.
    const { useOnboardingStore: onboarding } = await import("../store/onboardingStore");
    expect(onboarding.getState().startCenterOpen).toBe(true);
  });

  it("keeps unsaved work when the user cancels replacement", async () => {
    const { store, handleOpenFileResult } = await mount();
    store.setState({ mnxJson: "changed", savedMnxJson: "saved" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    deliver({ files: [fileHandle()] });
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(handleOpenFileResult).not.toHaveBeenCalled();
    expect(store.getState().mnxJson).toBe("changed");
  });

  it("protects edits made while reading the launched file", async () => {
    const { store, handleOpenFileResult } = await mount();
    const handle = fileHandle();
    let finishRead!: (file: File) => void;
    vi.mocked(handle.getFile).mockReturnValue(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    deliver({ files: [handle] });
    await waitFor(() => expect(handle.getFile).toHaveBeenCalled());
    store.setState({ mnxJson: "changed", savedMnxJson: "saved" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    finishRead(new File(["{}"], "score.mnx"));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(handleOpenFileResult).not.toHaveBeenCalled();
  });

  it("rejects a multi-file launch rather than silently replacing documents", async () => {
    const { handleOpenFileResult, setFileError } = await mount();
    deliver({ files: [fileHandle("one.mnx"), fileHandle("two.mnx")] });
    await waitFor(() => expect(setFileError).toHaveBeenCalledWith("Please open one MNX document at a time."));
    expect(handleOpenFileResult).not.toHaveBeenCalled();
  });

  it("does not replace a live-session document", async () => {
    const { handleOpenFileResult, setFileError } = await mount();
    window.history.replaceState({}, "", "/#live=abcd2345abcd2345");
    deliver({ files: [fileHandle()] });
    await waitFor(() => expect(setFileError).toHaveBeenCalledWith(expect.stringContaining("outside the live session")));
    expect(handleOpenFileResult).not.toHaveBeenCalled();
  });

  it("does not register a web launch consumer inside Tauri", async () => {
    const { isDesktopHost } = await import("../instrumentProfiles");
    vi.mocked(isDesktopHost).mockReturnValueOnce(true).mockReturnValueOnce(true);
    const { handleOpenFileResult } = await mount();
    expect(handleOpenFileResult).not.toHaveBeenCalled();
    expect(Reflect.get(window, "launchQueue").setConsumer).not.toHaveBeenCalled();
  });
});

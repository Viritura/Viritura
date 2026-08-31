import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectDirectory, getProjectFolderNameError, isFolderProjectSupported } from "../app/projectFolder";

const originalPicker = (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;

afterEach(() => {
  const target = window as unknown as { showDirectoryPicker?: unknown };
  if (originalPicker === undefined) delete target.showDirectoryPicker;
  else target.showDirectoryPicker = originalPicker;
});

describe("folder project capability", () => {
  it("silently detects directory picker support", () => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = vi.fn();
    expect(isFolderProjectSupported()).toBe(true);

    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    expect(isFolderProjectSupported()).toBe(false);
  });
});

describe("project folder creation", () => {
  it("rejects names that cannot be portable folder names", () => {
    expect(getProjectFolderNameError("")).not.toBeNull();
    expect(getProjectFolderNameError("../score")).not.toBeNull();
    expect(getProjectFolderNameError("Cue: 12")).not.toBeNull();
    expect(getProjectFolderNameError("Cue 12")).toBeNull();
  });

  it("creates a named child inside the selected parent", async () => {
    const child = { name: "Cue 12" } as FileSystemDirectoryHandle;
    const getDirectoryHandle = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("missing", "NotFoundError"))
      .mockResolvedValueOnce(child);
    const parent = { name: "Scores", getDirectoryHandle } as unknown as FileSystemDirectoryHandle;

    await expect(createProjectDirectory(parent, "Cue 12")).resolves.toBe(child);
    expect(getDirectoryHandle).toHaveBeenNthCalledWith(1, "Cue 12");
    expect(getDirectoryHandle).toHaveBeenNthCalledWith(2, "Cue 12", { create: true });
  });

  it("does not adopt or overwrite an existing child folder", async () => {
    const existing = { name: "Cue 12" } as FileSystemDirectoryHandle;
    const getDirectoryHandle = vi.fn().mockResolvedValue(existing);
    const parent = { name: "Scores", getDirectoryHandle } as unknown as FileSystemDirectoryHandle;

    await expect(createProjectDirectory(parent, "Cue 12")).rejects.toThrow("already exists");
    expect(getDirectoryHandle).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { prepareGistFiles } from "./prepareGistFiles";

const VALID_MNX = JSON.stringify({ mnx: { version: 1 }, global: { measures: [] }, parts: [] });

function file(name: string, content = VALID_MNX): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => ({ text: async () => content }),
  } as unknown as FileSystemFileHandle;
}

function folder(entries: Array<[string, FileSystemHandle]>): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    async *entries() {
      yield* entries;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("prepareGistFiles", () => {
  it("uses the current MNX as a one-file share", async () => {
    const files = await prepareGistFiles({
      projectFolder: null,
      activeScorePath: null,
      fileName: "score.mnx",
      currentMnx: VALID_MNX,
    });

    expect(files).toEqual({ "score.mnx": VALID_MNX });
  });

  it("rescans all nested files and includes the active in-memory document", async () => {
    const editedMnx = `${VALID_MNX} `;
    const root = folder([
      ["one.mnx", file("one.mnx")],
      ["new", folder([["deep", folder([["deeper", folder([["two.mnx", file("two.mnx", `${VALID_MNX}\n`)]])]])]])],
    ]);

    const files = await prepareGistFiles({
      projectFolder: root,
      activeScorePath: "one.mnx",
      fileName: "project",
      currentMnx: editedMnx,
    });

    expect(files).toEqual({ "01 - two.mnx": `${VALID_MNX}\n`, "02 - one.mnx": editedMnx });
  });

  it("rejects more than 50 files rather than sharing a truncated setlist", async () => {
    const root = folder(Array.from({ length: 51 }, (_, i) => [`${i}.mnx`, file(`${i}.mnx`)]));
    await expect(
      prepareGistFiles({ projectFolder: root, activeScorePath: "0.mnx", fileName: "project", currentMnx: VALID_MNX }),
    ).rejects.toThrow("at most 50");
  });

  it("reports directory read failures rather than sharing a partial setlist", async () => {
    const unreadable = {
      kind: "directory",
      entries() {
        throw new Error("Permission denied");
      },
    } as unknown as FileSystemDirectoryHandle;
    const root = folder([
      ["one.mnx", file("one.mnx")],
      ["unreadable", unreadable],
    ]);
    await expect(
      prepareGistFiles({ projectFolder: root, activeScorePath: "one.mnx", fileName: "project", currentMnx: VALID_MNX }),
    ).rejects.toThrow("Permission denied");
  });

  it("rejects a missing active score or an invalid project file", async () => {
    const root = folder([
      ["bad.mnx", file("bad.mnx", "not MNX")],
      ["one.mnx", file("one.mnx")],
    ]);
    const options = { projectFolder: root, activeScorePath: "missing.mnx", fileName: "project", currentMnx: VALID_MNX };
    await expect(prepareGistFiles(options)).rejects.toThrow("open score was not found");
    await expect(prepareGistFiles({ ...options, activeScorePath: "one.mnx" })).rejects.toThrow(
      "bad.mnx is not valid MNX",
    );
  });
});

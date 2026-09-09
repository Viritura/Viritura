import { beforeEach, describe, expect, it, vi } from "vitest";

const { convertMusxToMnx } = vi.hoisted(() => ({
  convertMusxToMnx: vi.fn(),
}));

vi.mock("@viritura/musx-import", () => ({
  convertMusxToMnx,
}));

import { convertImportedMusicFile, isMusicImportFilename } from "../commands/fileCommands";

const VALID_MNX = JSON.stringify({
  global: { measures: [] },
  parts: [],
});

describe("Finale MUSX import", () => {
  beforeEach(() => {
    convertMusxToMnx.mockReset();
    convertMusxToMnx.mockResolvedValue({
      mnxJson: VALID_MNX,
      diagnostics: [{ severity: "warning", message: "A Finale-only detail was omitted." }],
      denigmaVersion: "4.0.0",
      denigmaCommit: "abc123",
    });
  });

  it("recognizes supported import filenames case-insensitively", () => {
    expect(isMusicImportFilename("score.MUSX")).toBe(true);
    expect(isMusicImportFilename("score.musicxml")).toBe(true);
    expect(isMusicImportFilename("score.mxl")).toBe(true);
    expect(isMusicImportFilename("score.mnx")).toBe(false);
  });

  it("converts MUSX bytes with Denigma and preserves diagnostics", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "Finale Score.MUSX", {
      type: "application/octet-stream",
    });

    const result = await convertImportedMusicFile(file);

    expect(convertMusxToMnx).toHaveBeenCalledWith(expect.any(ArrayBuffer), "Finale Score.MUSX", {
      includeTempoTool: true,
    });
    expect(result).toEqual({
      mnxJson: VALID_MNX,
      filename: "Finale Score.mnx",
      fileHandle: null,
      importDiagnostics: [{ severity: "warning", message: "A Finale-only detail was omitted." }],
    });
  });

  it("rejects invalid MNX returned by Denigma", async () => {
    convertMusxToMnx.mockResolvedValue({
      mnxJson: "{}",
      diagnostics: [],
      denigmaVersion: "4.0.0",
      denigmaCommit: "abc123",
    });

    const file = new File([new Uint8Array([1])], "broken.musx");

    await expect(convertImportedMusicFile(file)).rejects.toThrow("Denigma produced invalid MNX");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { convertMusxToMnx } = vi.hoisted(() => ({
  convertMusxToMnx: vi.fn(),
}));

vi.mock("@viritura/musx-import", () => ({
  convertMusxToMnx,
  MAX_MUSX_BYTES: 64 * 1024 * 1024,
}));

import { convertImportedMusicFile, importMusicFile, isMusicImportFilename } from "../commands/fileCommands";

const VALID_MNX = readFileSync(resolve(process.cwd(), "../../packages/format/fixtures/mnx/hello-world.mnx"), "utf8");

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

  it("limits the native picker to music notation extensions", async () => {
    const showOpenFilePicker = vi.fn().mockResolvedValue([]);
    Object.assign(window, { showOpenFilePicker });

    await importMusicFile();

    expect(showOpenFilePicker).toHaveBeenCalledWith({
      types: [
        {
          description: "Music Notation Files",
          accept: {
            "application/xml": [".mxl", ".musicxml", ".xml"],
            "application/x-finale-musx": [".musx"],
          },
        },
      ],
      multiple: false,
    });
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

  it("rejects schema-invalid notation even when Denigma reports success", async () => {
    const invalid = JSON.parse(VALID_MNX) as {
      parts: Array<{
        measures: Array<{
          sequences: Array<{ content: Array<Record<string, unknown>> }>;
        }>;
      }>;
    };
    invalid.parts[0]!.measures[0]!.sequences[0]!.content[0]!.markings = {
      tremolo: { marks: 0 },
    };
    convertMusxToMnx.mockResolvedValue({
      mnxJson: JSON.stringify(invalid),
      diagnostics: [],
      denigmaVersion: "4.0.0",
      denigmaCommit: "abc123",
    });

    const file = new File([new Uint8Array([1])], "tremolo.musx");

    await expect(convertImportedMusicFile(file)).rejects.toThrow(/marks/);
  });

  it("rejects oversized MUSX files before reading their bytes", async () => {
    const arrayBuffer = vi.fn();
    const file = {
      name: "oversized.musx",
      size: 64 * 1024 * 1024 + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(convertImportedMusicFile(file)).rejects.toThrow("64 MiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(convertMusxToMnx).not.toHaveBeenCalled();
  });
});

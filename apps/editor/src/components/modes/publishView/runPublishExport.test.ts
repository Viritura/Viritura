import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { Score } from "@viritura/core";
import { exportScoresToPdf, triggerDownload } from "../../../publish/batchRender";
import { runPublishExport, type RunExportArgs } from "./runPublishExport";

vi.mock("../../../publish/batchRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../publish/batchRender")>()),
  exportScoresToPdf: vi.fn(),
  triggerDownload: vi.fn(),
}));

const pdfs = Array.from({ length: 12 }, (_, scoreIndex) => ({
  scoreIndex,
  name: `Layout ${scoreIndex + 1}`,
  bytes: new Uint8Array([37, 80, 68, 70, scoreIndex]),
}));

function exportArgs(overrides: Partial<RunExportArgs> = {}): RunExportArgs {
  const score: Score = {
    mnx: { version: 1 },
    metadata: { title: "Quartet" },
    global: { measures: [] },
    parts: [],
  };
  return {
    score,
    scoreIndices: pdfs.map((pdf) => pdf.scoreIndex),
    bundleMode: "zip",
    filenamePattern: "%TITLE% - %PART%",
    embedMnx: true,
    exportFolder: null,
    onProgress: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportScoresToPdf).mockResolvedValue(pdfs);
});

describe("Publish export delivery", () => {
  it("downloads one ZIP containing every selected PDF beyond browser batch limits", async () => {
    const args = exportArgs();
    await expect(runPublishExport(args)).resolves.toEqual({
      kind: "ok",
      text: "Exported ZIP archive (12 parts).",
    });
    expect(exportScoresToPdf).toHaveBeenCalledWith(args.score, {
      scoreIndices: args.scoreIndices,
      embedMnx: true,
      onProgress: args.onProgress,
    });
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Uint8Array),
      "Quartet - Parts.zip",
      "application/zip",
    );
    const zip = await JSZip.loadAsync(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(Object.keys(zip.files)).toHaveLength(12);
    for (const pdf of pdfs) {
      expect(await zip.file(`Quartet - ${pdf.name}.pdf`)!.async("uint8array")).toEqual(pdf.bytes);
    }
  });

  it("writes every separate PDF directly to the chosen folder with no browser downloads", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const getFileHandle = vi.fn().mockResolvedValue({ createWritable });
    await expect(
      runPublishExport(exportArgs({ bundleMode: "separate", exportFolder: { name: "Project", getFileHandle } })),
    ).resolves.toEqual({ kind: "ok", text: 'Exported 12 files to "Project".' });

    expect(getFileHandle).toHaveBeenCalledTimes(12);
    for (const [index, pdf] of pdfs.entries()) {
      expect(getFileHandle).toHaveBeenNthCalledWith(index + 1, `Quartet - ${pdf.name}.pdf`, { create: true });
      expect(write).toHaveBeenNthCalledWith(index + 1, pdf.bytes);
    }
    expect(close).toHaveBeenCalledTimes(12);
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("still downloads a single combined PDF with all pages in layout order", async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]);
    source.addPage([400, 500]);
    const bytes = await source.save();
    vi.mocked(exportScoresToPdf).mockResolvedValue(pdfs.slice(0, 2).map((pdf) => ({ ...pdf, bytes })));

    await runPublishExport(exportArgs({ bundleMode: "single-pdf", scoreIndices: [0, 1] }));
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Uint8Array),
      "Quartet - All Parts.pdf",
      "application/pdf",
    );
    const merged = await PDFDocument.load(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(merged.getPages().map((page) => page.getSize())).toEqual([
      { width: 200, height: 300 },
      { width: 400, height: 500 },
      { width: 200, height: 300 },
      { width: 400, height: 500 },
    ]);
  });

  it("rejects separate downloads before rendering instead of reporting incomplete delivery as success", async () => {
    await expect(runPublishExport(exportArgs({ bundleMode: "separate" }))).rejects.toThrow("Choose a folder");
    expect(exportScoresToPdf).not.toHaveBeenCalled();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("surfaces denied disk access instead of falling back to browser downloads", async () => {
    const error = new DOMException("Write permission denied", "NotAllowedError");
    const getFileHandle = vi.fn().mockRejectedValue(error);
    await expect(
      runPublishExport(exportArgs({ bundleMode: "separate", exportFolder: { name: "Project", getFileHandle } })),
    ).rejects.toBe(error);
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});

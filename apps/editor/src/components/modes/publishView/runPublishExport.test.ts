import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { LayoutContent, Score } from "@viritura/core";
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

function staff(...partIds: string[]): LayoutContent {
  return { type: "staff", sources: partIds.map((part) => ({ part })) };
}

function numberedScore(): Score {
  return {
    mnx: { version: 1 },
    metadata: { title: "Quartet" },
    global: { measures: [] },
    parts: [
      { id: "piano", name: "Piano", measures: [] },
      { id: "bassoon", name: "Bassoon", measures: [] },
      { id: "oboe", name: "Oboe", measures: [] },
      { id: "flute", name: "Flute", measures: [] },
    ],
    layouts: [
      {
        id: "full",
        content: [
          { type: "group", content: [{ type: "group", content: [staff("flute", "oboe")] }] },
          { type: "group", content: [staff("piano"), staff("piano")] },
        ],
      },
      { id: "piano", content: [{ type: "group", content: [staff("piano"), staff("piano")] }] },
      { id: "bassoon", content: [staff("bassoon")] },
      { id: "winds", content: [staff("flute"), staff("oboe")] },
      { id: "oboe", content: [staff("oboe")] },
      { id: "flute", content: [staff("flute")] },
    ],
    scores: [
      { name: "Piano", layout: "piano" },
      { name: "Full Score", layout: "full" },
      { name: "Bassoon", layout: "bassoon" },
      { name: "Woodwinds", layout: "winds" },
      { name: "Oboe", layout: "oboe" },
      { name: "Flute", pages: [{ systems: [{ measure: "m1" }, { measure: "m2", layout: "flute" }] }] },
      { name: "Unresolved" },
    ],
  };
}

function mockScorePdfs(score: Score) {
  vi.mocked(exportScoresToPdf).mockImplementation(async (_score, { scoreIndices }) =>
    scoreIndices.map((scoreIndex) => ({
      scoreIndex,
      name: score.scores![scoreIndex]!.name!,
      bytes: new Uint8Array([37, 80, 68, 70, scoreIndex]),
    })),
  );
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

  it("numbers a partial ZIP export in full-score order, independently of layout and instrument list order", async () => {
    const score = numberedScore();
    mockScorePdfs(score);
    const result = await runPublishExport(
      exportArgs({
        score,
        scoreIndices: [0, 2, 4, 5, 6],
        filenamePattern: "%PART_NUMBER% - %TITLE% - %PART%",
      }),
    );

    expect(result.text).toContain("Parts absent from the full score follow the instrument list.");
    expect(result.text).toContain("Some layouts have no identifiable instruments");
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Uint8Array),
      "All - Quartet - Parts.zip",
      "application/zip",
    );
    const zip = await JSZip.loadAsync(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(Object.keys(zip.files)).toEqual([
      "03 - Quartet - Flute.pdf",
      "04 - Quartet - Oboe.pdf",
      "05 - Quartet - Piano.pdf",
      "06 - Quartet - Bassoon.pdf",
      "07 - Quartet - Unresolved.pdf",
    ]);
  });

  it("keeps duplicate part layouts distinct when the number token is used", async () => {
    const score = numberedScore();
    score.scores!.push({ name: "Flute", layout: "flute" });
    mockScorePdfs(score);
    await runPublishExport(exportArgs({ score, scoreIndices: [5, 7], filenamePattern: "%PART_NUMBER% - %PART%" }));

    const zip = await JSZip.loadAsync(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(Object.keys(zip.files).sort()).toEqual(["03 - Flute.pdf", "04 - Flute.pdf"]);
  });

  it("pads to the full document's width when saving a subset of more than 100 layouts", async () => {
    const parts = Array.from({ length: 101 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Part ${index + 1}`,
      measures: [],
    }));
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [] },
      parts,
      layouts: [
        { id: "full", content: parts.map((part) => staff(part.id)) },
        ...parts.map((part) => ({ id: part.id, content: [staff(part.id)] })),
      ],
      scores: [
        { name: "Full Score", layout: "full" },
        ...parts.toReversed().map((part) => ({ name: part.name, layout: part.id })),
      ],
    };
    mockScorePdfs(score);
    const getFileHandle = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn() }),
    });
    await runPublishExport(
      exportArgs({
        score,
        scoreIndices: [3, 1, 93, 0, 101],
        bundleMode: "separate",
        filenamePattern: "%PART_NUMBER% - %PART%",
        exportFolder: { name: "Project", getFileHandle },
      }),
    );

    expect(getFileHandle.mock.calls.map(([name]) => name)).toEqual([
      "001 - Full Score.pdf",
      "002 - Part 1.pdf",
      "010 - Part 9.pdf",
      "100 - Part 99.pdf",
      "102 - Part 101.pdf",
    ]);
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("uses the instrument list and reports it when no full score is available", async () => {
    const score = numberedScore();
    score.scores = [score.scores![5]!, score.scores![0]!];
    mockScorePdfs(score);
    const result = await runPublishExport(
      exportArgs({ score, scoreIndices: [0, 1], filenamePattern: "%PART_NUMBER% - %PART%" }),
    );

    expect(result.text).toContain("No full score was identified; numbering uses the instrument list.");
    const zip = await JSZip.loadAsync(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(Object.keys(zip.files).sort()).toEqual(["01 - Piano.pdf", "02 - Flute.pdf"]);
  });

  it("uses the fullest score as reference when the full score was renamed", async () => {
    const score = numberedScore();
    score.scores![1]!.name = "Conductor";
    mockScorePdfs(score);
    const result = await runPublishExport(
      exportArgs({ score, scoreIndices: [0, 1, 4, 5], filenamePattern: "%PART_NUMBER% - %PART%" }),
    );

    expect(result.text).toContain("the score with the most instruments determines the order");
    const zip = await JSZip.loadAsync(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(Object.keys(zip.files).sort()).toEqual([
      "01 - Conductor.pdf",
      "03 - Flute.pdf",
      "04 - Oboe.pdf",
      "05 - Piano.pdf",
    ]);
  });

  it("uses the named full score even if another score has more instruments", async () => {
    const score = numberedScore();
    score.layouts!.find((layout) => layout.id === "winds")!.content = [
      staff("bassoon"),
      staff("piano"),
      staff("oboe"),
      staff("flute"),
    ];
    mockScorePdfs(score);
    await runPublishExport(
      exportArgs({ score, scoreIndices: [0, 2, 4, 5], filenamePattern: "%PART_NUMBER% - %PART%" }),
    );

    const zip = await JSZip.loadAsync(vi.mocked(triggerDownload).mock.calls[0]![0]);
    expect(Object.keys(zip.files)).toEqual(["03 - Flute.pdf", "04 - Oboe.pdf", "05 - Piano.pdf", "06 - Bassoon.pdf"]);
  });

  it("names a combined PDF without inserting a particular part number", async () => {
    const score = numberedScore();
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = await source.save();
    vi.mocked(exportScoresToPdf).mockResolvedValue([
      { scoreIndex: 0, name: "Piano", bytes },
      { scoreIndex: 5, name: "Flute", bytes },
    ]);
    await runPublishExport(
      exportArgs({
        score,
        scoreIndices: [0, 5],
        bundleMode: "single-pdf",
        filenamePattern: "%PART_NUMBER% - %TITLE% - %PART%",
      }),
    );
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Uint8Array),
      "All - Quartet - All Parts.pdf",
      "application/pdf",
    );
  });

  it("does not require layout numbering to create a combined PDF", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = await source.save();
    vi.mocked(exportScoresToPdf).mockResolvedValue([{ scoreIndex: 0, name: "Layout", bytes }]);
    await expect(
      runPublishExport(
        exportArgs({
          scoreIndices: [0],
          bundleMode: "single-pdf",
          filenamePattern: "%PART_NUMBER% - %PART%",
        }),
      ),
    ).resolves.toEqual({ kind: "ok", text: "Exported single PDF (1 part)." });
    expect(triggerDownload).toHaveBeenCalledExactlyOnceWith(
      expect.any(Uint8Array),
      "All - All Parts.pdf",
      "application/pdf",
    );
  });

  it("rejects a missing layout before rendering when numbering is requested", async () => {
    await expect(
      runPublishExport(
        exportArgs({ score: numberedScore(), scoreIndices: [99], filenamePattern: "%PART_NUMBER% - %PART%" }),
      ),
    ).rejects.toThrow("not in the current document");
    expect(exportScoresToPdf).not.toHaveBeenCalled();
  });
});

import type { Score } from "@viritura/core";
import {
  exportScoresToPdf,
  formatFilename,
  triggerDownload,
  concatPdfs,
  zipPdfs,
  writeFileToDirectory,
  type FsDirectoryHandle,
} from "../../../publish/batchRender";
import { numberLayoutsInScoreOrder } from "./scoreOrder";

export type BundleMode = "separate" | "single-pdf" | "zip";

export interface RunExportArgs {
  score: Score;
  scoreIndices: number[];
  bundleMode: BundleMode;
  filenamePattern: string;
  embedMnx: boolean;
  exportFolder: FsDirectoryHandle | null;
  onProgress: (done: number, total: number, name: string) => void;
}

export interface RunExportResult {
  kind: "ok";
  text: string;
}

/**
 * Run the publish-mode PDF export with the user-selected bundle mode and
 * destination. Throws on failure; the caller is expected to surface the
 * error to the status bar.
 */
export async function runPublishExport({
  score,
  scoreIndices,
  bundleMode,
  filenamePattern,
  embedMnx,
  exportFolder,
  onProgress,
}: RunExportArgs): Promise<RunExportResult> {
  if (bundleMode === "separate" && !exportFolder) {
    throw new Error("Choose a folder for separate PDFs, or download a ZIP archive or single PDF.");
  }
  const numbering =
    bundleMode !== "single-pdf" && filenamePattern.includes("%PART_NUMBER%")
      ? numberLayoutsInScoreOrder(score, scoreIndices)
      : null;
  if (numbering && scoreIndices.some((index) => !numbering.numbers.has(index))) {
    throw new Error("Cannot number a layout that is not in the current document.");
  }
  const pdfs = await exportScoresToPdf(score, { scoreIndices, embedMnx, onProgress });
  const title = score.metadata?.title;
  const named = pdfs.map((p) => {
    const partNumber = numbering ? numbering.numbers.get(p.scoreIndex) : "All";
    if (partNumber === undefined) throw new Error(`Cannot number layout ${p.scoreIndex + 1}.`);
    return {
      ...p,
      partNumber,
      filename: formatFilename(filenamePattern, { title, part: p.name, partNumber }) + ".pdf",
    };
  });
  if (numbering) named.sort((a, b) => Number(a.partNumber) - Number(b.partNumber));

  const writeOne = async (filename: string, bytes: Uint8Array, mime: string) => {
    if (exportFolder) {
      await writeFileToDirectory(exportFolder, filename, bytes);
    } else {
      triggerDownload(bytes, filename, mime);
    }
  };
  const destSuffix = exportFolder ? ` to "${exportFolder.name}"` : "";
  const warningSuffix = numbering?.warnings.length ? ` ${numbering.warnings.join(" ")}` : "";

  if (bundleMode === "separate") {
    for (const p of named) await writeOne(p.filename, p.bytes, "application/pdf");
    return {
      kind: "ok",
      text: `Exported ${named.length} file${named.length === 1 ? "" : "s"}${destSuffix}.${warningSuffix}`,
    };
  }

  if (bundleMode === "single-pdf") {
    const merged = await concatPdfs(named);
    const filename = formatFilename(filenamePattern, { title, part: "All Parts", partNumber: "All" }) + ".pdf";
    await writeOne(filename, merged, "application/pdf");
    return {
      kind: "ok",
      text: `Exported single PDF (${named.length} part${named.length === 1 ? "" : "s"})${destSuffix}.${warningSuffix}`,
    };
  }

  const zipBytes = await zipPdfs(named.map((p) => ({ name: p.filename, bytes: p.bytes })));
  const zipName = formatFilename(filenamePattern, { title, part: "Parts", partNumber: "All" }) + ".zip";
  await writeOne(zipName, zipBytes, "application/zip");
  return {
    kind: "ok",
    text: `Exported ZIP archive (${named.length} part${named.length === 1 ? "" : "s"})${destSuffix}.${warningSuffix}`,
  };
}

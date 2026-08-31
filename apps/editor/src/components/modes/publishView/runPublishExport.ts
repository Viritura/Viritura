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
  const pdfs = await exportScoresToPdf(score, { scoreIndices, embedMnx, onProgress });
  const title = score.metadata?.title;
  const named = pdfs.map((p) => ({
    ...p,
    filename: formatFilename(filenamePattern, { title, part: p.name }) + ".pdf",
  }));

  const writeOne = async (filename: string, bytes: Uint8Array, mime: string) => {
    if (exportFolder) {
      await writeFileToDirectory(exportFolder, filename, bytes);
    } else {
      triggerDownload(bytes, filename, mime);
    }
  };
  const destSuffix = exportFolder ? ` to "${exportFolder.name}"` : "";

  if (bundleMode === "separate") {
    for (const p of named) await writeOne(p.filename, p.bytes, "application/pdf");
    return {
      kind: "ok",
      text: `Exported ${named.length} file${named.length === 1 ? "" : "s"}${destSuffix}.`,
    };
  }

  if (bundleMode === "single-pdf") {
    const merged = await concatPdfs(named);
    const filename = formatFilename(filenamePattern, { title, part: "All Parts" }) + ".pdf";
    await writeOne(filename, merged, "application/pdf");
    return {
      kind: "ok",
      text: `Exported single PDF (${named.length} part${named.length === 1 ? "" : "s"})${destSuffix}.`,
    };
  }

  const zipBytes = await zipPdfs(named.map((p) => ({ name: p.filename, bytes: p.bytes })));
  const zipName = formatFilename(filenamePattern, { title, part: "Parts" }) + ".zip";
  await writeOne(zipName, zipBytes, "application/zip");
  return {
    kind: "ok",
    text: `Exported ZIP archive (${named.length} part${named.length === 1 ? "" : "s"})${destSuffix}.`,
  };
}

import type { Score } from "@viritura/core";
import { convertScoreToMusicXml, convertScoreToMxl, MUSICXML_MIME, MXL_MIME } from "@viritura/musicxml";
import {
  formatFilename,
  triggerDownload,
  writeFileToDirectory,
  zipFiles,
  type FsDirectoryHandle,
} from "../../../publish/batchRender";
import type { MusicXmlFormat } from "./audioFormats";
import { numberLayoutsInScoreOrder } from "./scoreOrder";
import type { BundleMode, RunExportResult } from "./runPublishExport";

function uniqueFilename(base: string, format: MusicXmlFormat, used: Set<string>): { name: string; renamed: boolean } {
  let name = `${base}.${format}`;
  let suffix = 2;
  while (used.has(name.normalize("NFC").toLowerCase())) name = `${base} (${suffix++}).${format}`;
  used.add(name.normalize("NFC").toLowerCase());
  return { name, renamed: suffix !== 2 };
}

function selectedScore(score: Score, index: number) {
  const definition = score.scores?.at(index);
  if (!Number.isInteger(index) || index < 0 || !definition) throw new Error("A selected score no longer exists.");
  return definition;
}

export async function runMusicXmlExport({
  score,
  scoreIndices,
  format,
  bundleMode,
  filenamePattern,
  exportFolder,
  signal,
  onProgress,
}: {
  score: Score;
  scoreIndices: number[];
  format: MusicXmlFormat;
  bundleMode: BundleMode;
  filenamePattern: string;
  exportFolder: FsDirectoryHandle | null;
  signal: AbortSignal;
  onProgress: (done: number, total: number, name: string) => void;
}): Promise<RunExportResult> {
  signal.throwIfAborted();
  if (scoreIndices.length === 0) throw new Error("Select at least one score or part to export.");
  if (new Set(scoreIndices).size !== scoreIndices.length)
    throw new Error("The export selection contains duplicate scores.");
  if (bundleMode === "separate" && !exportFolder)
    throw new Error("Choose a folder for separate MusicXML files, or download a ZIP archive.");
  const numbering = filenamePattern.includes("%PART_NUMBER%")
    ? numberLayoutsInScoreOrder(score, scoreIndices)
    : undefined;
  const indices = [...scoreIndices];
  if (numbering) indices.sort((a, b) => Number(numbering.numbers.get(a)) - Number(numbering.numbers.get(b)));
  const warnings = new Set(numbering?.warnings);
  const files: { name: string; bytes: Uint8Array }[] = [];
  const filenames = new Set<string>();
  for (const index of indices) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
    const definition = selectedScore(score, index);
    const partNumber = numbering ? numbering.numbers.get(index) : "All";
    if (partNumber === undefined) throw new Error("A selected score could not be numbered.");
    const name = definition.name ?? `Score ${index + 1}`;
    const base = formatFilename(filenamePattern, { title: score.metadata?.title, part: name, partNumber });
    const filename = uniqueFilename(base, format, filenames);
    if (filename.renamed) warnings.add("Matching filenames were given numeric suffixes to keep every selected score.");
    const result =
      format === "mxl"
        ? await convertScoreToMxl(score, { scoreIndex: index })
        : convertScoreToMusicXml(score, { scoreIndex: index });
    const bytes = "bytes" in result ? result.bytes : new TextEncoder().encode(result.xml);
    for (const diagnostic of result.diagnostics) warnings.add(diagnostic.message);
    files.push({ name: filename.name, bytes });
    onProgress(files.length, indices.length, name);
  }
  const write = async (name: string, bytes: Uint8Array, mime: string) => {
    signal.throwIfAborted();
    if (exportFolder) await writeFileToDirectory(exportFolder, name, bytes, signal);
    else triggerDownload(bytes, name, mime);
  };
  const mime = format === "mxl" ? MXL_MIME : MUSICXML_MIME;
  if (bundleMode === "separate" || files.length === 1) {
    for (const file of files) await write(file.name, file.bytes, mime);
  } else {
    const bytes = await zipFiles(files);
    await write(
      `${formatFilename(filenamePattern, { title: score.metadata?.title, part: "Parts", partNumber: "All" })}.zip`,
      bytes,
      "application/zip",
    );
  }
  return {
    kind: "ok",
    text: `Exported ${files.length} MusicXML file${files.length === 1 ? "" : "s"}${exportFolder ? ` to "${exportFolder.name}"` : ""}.`,
    warnings: [...warnings],
  };
}

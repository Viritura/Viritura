import type { Score } from "@viritura/core";
import { exportScoreMidi } from "@viritura/playback";
import {
  formatFilename,
  triggerDownload,
  writeFileToDirectory,
  type FsDirectoryHandle,
} from "../../../publish/batchRender";
import type { RunExportResult } from "./runPublishExport";

export async function runMidiExport({
  score,
  filenamePattern,
  exportFolder,
  signal,
}: {
  score: Score;
  filenamePattern: string;
  exportFolder: FsDirectoryHandle | null;
  signal: AbortSignal;
}): Promise<RunExportResult> {
  const { bytes, warnings } = exportScoreMidi(score);
  if (signal.aborted) throw new DOMException("MIDI export cancelled.", "AbortError");
  const filename = `${formatFilename(filenamePattern, {
    title: score.metadata?.title,
    part: "Full Score",
    partNumber: "All",
  })}.mid`;
  if (exportFolder) await writeFileToDirectory(exportFolder, filename, bytes, signal);
  else triggerDownload(bytes, filename, "audio/midi");
  return {
    kind: "ok",
    text: `Exported ${filename}${exportFolder ? ` to "${exportFolder.name}"` : ""}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
  };
}

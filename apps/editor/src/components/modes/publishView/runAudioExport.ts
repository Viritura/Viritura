import type { Score } from "@viritura/core";
import { exportScoreAudio, type AudioEncoding, type AudioExportSettings, type AudioPartMix } from "@viritura/playback";
import { getDesktopSoundfontLoader } from "../../../desktopAudio";
import {
  formatFilename,
  triggerDownload,
  writeFileToDirectory,
  type FsDirectoryHandle,
} from "../../../publish/batchRender";
import type { RunExportResult } from "./runPublishExport";

const MIME_TYPES: Record<AudioEncoding["format"], string> = { mp3: "audio/mpeg", wav: "audio/wav" };

export interface RunAudioExportArgs {
  score: Score;
  encoding: AudioEncoding;
  mix?: readonly AudioPartMix[];
  settings?: AudioExportSettings;
  filenamePattern: string;
  exportFolder: FsDirectoryHandle | null;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}

export async function runAudioExport({
  score,
  encoding,
  mix,
  settings,
  filenamePattern,
  exportFolder,
  signal,
  onProgress,
}: RunAudioExportArgs): Promise<RunExportResult> {
  const { bytes, warnings } = await exportScoreAudio(score, encoding, {
    mix,
    settings,
    soundfontLoader: getDesktopSoundfontLoader(),
    signal,
    onProgress,
  });
  if (signal.aborted) throw new DOMException("Audio export cancelled.", "AbortError");
  const filename = `${formatFilename(filenamePattern, {
    title: score.metadata?.title,
    part: "Full Score",
    partNumber: "All",
  })}.${encoding.format}`;
  if (exportFolder) {
    await writeFileToDirectory(exportFolder, filename, bytes, signal);
  } else {
    triggerDownload(bytes, filename, MIME_TYPES[encoding.format]);
  }
  return {
    kind: "ok",
    text: `Exported ${filename}${exportFolder ? ` to "${exportFolder.name}"` : ""}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
  };
}

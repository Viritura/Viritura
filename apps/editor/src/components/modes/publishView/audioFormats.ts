import type { AudioEncoding, Mp3Bitrate, WavBitDepth } from "@viritura/playback";

export type AudioExportFormat = AudioEncoding["format"];
export type ExportFormat = "pdf" | "midi" | AudioExportFormat;

export function isAudioFormat(format: ExportFormat): format is AudioExportFormat {
  return format === "mp3" || format === "wav";
}

export interface AudioQuality {
  mp3Bitrate: Mp3Bitrate;
  wavBitDepth: WavBitDepth;
}

export const DEFAULT_AUDIO_QUALITY: AudioQuality = { mp3Bitrate: 192, wavBitDepth: 24 };

export function audioEncoding(format: AudioExportFormat, quality: AudioQuality): AudioEncoding {
  return format === "mp3" ? { format, bitrate: quality.mp3Bitrate } : { format, bitDepth: quality.wavBitDepth };
}

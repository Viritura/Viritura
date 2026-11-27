import type { AudioEncoding, Mp3Bitrate, WavBitDepth } from "@viritura/playback";

export type AudioExportFormat = AudioEncoding["format"];
export type MusicXmlFormat = "musicxml" | "mxl";
export type ExportFormat = "pdf" | "midi" | MusicXmlFormat | AudioExportFormat;

export function isMusicXmlFormat(format: ExportFormat): format is MusicXmlFormat {
  return format === "musicxml" || format === "mxl";
}

export function isLayoutFormat(format: ExportFormat): boolean {
  return format === "pdf" || isMusicXmlFormat(format);
}

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

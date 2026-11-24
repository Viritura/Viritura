import { unpackMusicXml } from "./archive";
import { convertMusicXmlToMnx } from "./convert";
import type { ConvertOptions } from "./convert";
import type { MnxDocument } from "./types";

export { convertMusicXmlToMnx } from "./convert";
export { convertScoreToMusicXml, convertScoreToMxl } from "./export";
export { MUSICXML_MIME, MXL_MIME } from "./archive";
export type { MusicXmlExportOptions, MusicXmlExportResult, MxlExportResult } from "./export";
export type { ConvertOptions, PercussionImportReview } from "./convert";
// Re-export the shared diagnostics surface so consumers don't have to add
// @viritura/core as a separate dep.
export { DiagnosticCollector, type MnxDiagnostic, type DiagnosticSeverity } from "@viritura/core";
export type {
  MnxDocument,
  MnxGlobal,
  MnxGlobalMeasure,
  MnxPart,
  MnxPartMeasure,
  MnxClef,
  MnxPositionedClef,
  MnxDynamic,
  MnxSequence,
  MnxSequenceContent,
  MnxEvent,
  MnxGraceEvent,
  MnxTuplet,
  MnxSpace,
  MnxDuration,
  MnxNote,
  MnxPitch,
  MnxTie,
  MnxSlur,
  MnxEventMarkings,
  MnxEventLyrics,
  MnxBeam,
  MnxOttava,
  MnxTempo,
  MnxEnding,
  MnxRhythmicPosition,
  MnxTransposition,
  MnxNoteValueQuantity,
  MnxSystemLayout,
  MnxLayoutContent,
  MnxLayoutGroup,
  MnxLayoutStaff,
  MnxScore,
  MnxRest,
} from "./types";

/**
 * Convert a .mxl archive (ZIP containing MusicXML) to an MNX document.
 * Works in both browser and Node.js environments.
 */
export async function convertMxlToMnx(
  buffer: ArrayBuffer | Uint8Array,
  options?: ConvertOptions,
): Promise<MnxDocument> {
  const xmlString = await unpackMusicXml(buffer);
  return convertMusicXmlToMnx(xmlString, options);
}

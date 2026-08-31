/**
 * @viritura/format — MNX parser and serializer.
 *
 * Converts between MNX JSON files and the @viritura/core typed model.
 */

export { parseMnx, parseMnxWithDiagnostics } from "./mnx";
export type { ParseMnxOptions, ParseMnxResult } from "./mnx";
export { promote, promoteUnknown, promoteWithDiagnostics } from "./mnx";
export type { RawScore, PromoteOptions, PromoteResult } from "./mnx";
export { isRawScore, assertRawScore, validateRawScore, RawScoreValidationFailure } from "./mnx";
export type { RawScoreValidationError, RawScoreValidationResult } from "./mnx";
export { serializeMnx } from "./mnx";
export {
  serializeEvent,
  serializeSequenceContent,
  serializeArpeggio,
  serializeNonArpeggio,
  serializeDynamicGroup,
} from "./mnx";
export { DeltaSerializer } from "./mnx";
export type { DeltaSerializationResult } from "./mnx";
export { loadMnxFromUrl, loadMnxFromString } from "./mnx";
export { DiagnosticCollector, mnxPointer, mnxPointerChild } from "./mnx";
export type { MnxDiagnostic, DiagnosticSeverity } from "./mnx";

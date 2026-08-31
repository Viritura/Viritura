/**
 * Barrel for the MNX subsystem (parser, serializer, validator, loader,
 * promote pipeline, delta serializer, diagnostic plumbing).
 *
 * Consumers should import from `@viritura/format` rather than reaching
 * into this folder directly; the package barrel re-exports through here.
 */

export { parseMnx, parseMnxWithDiagnostics } from "./parser";
export type { ParseMnxOptions, ParseMnxResult } from "./parser";
export { promote, promoteUnknown, promoteWithDiagnostics } from "./promote";
export type { RawScore, PromoteOptions, PromoteResult } from "./promote";
export { isRawScore, assertRawScore, validateRawScore, RawScoreValidationFailure } from "./validator";
export type { RawScoreValidationError, RawScoreValidationResult } from "./validator";
export { serializeMnx, serializeEvent, serializeSequenceContent } from "./serializer";
export { serializeArpeggio, serializeNonArpeggio, serializeDynamicGroup } from "./serializePart";
export { DeltaSerializer } from "./deltaSerializer";
export type { DeltaSerializationResult } from "./deltaSerializer";
export { loadMnxFromUrl, loadMnxFromString } from "./loader";
export { DiagnosticCollector, ptr as mnxPointer, ptrChild as mnxPointerChild } from "./diagnostics";
export type { MnxDiagnostic, DiagnosticSeverity } from "./diagnostics";

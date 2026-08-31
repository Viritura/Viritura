/**
 * MNX Raw → decoded Score promotion.
 *
 * This is the type-safe entry point for converting a Raw MNX document
 * (matching the wire shape generated from the MNX JSON Schema in
 * {@link @viritura/core/raw}) into the decoded {@link Score} model used by
 * the renderer and engine.
 *
 * The full pipeline is **validate → promote**: untyped JSON enters via
 * {@link promoteUnknown} (or `parseMnx`), which calls
 * {@link assertRawScore} to enforce the MNX JSON Schema at runtime;
 * once narrowed to {@link RawScore}, {@link promote} runs the typed
 * transformations:
 *
 *   - required-ID filling (auto-assign IDs to elements that lack one)
 *   - `_x.viritura` vendor-extension promotion to typed top-level fields
 *     (e.g. `metadata`)
 *   - enum / discriminated-union decoding
 *   - support-flag consistency validation
 *   - unknown-field diagnostics
 *
 * Every schema-defined parse helper consumes the typed `Raw*` shapes
 * from {@link @viritura/core/raw}, so schema drift surfaces as a
 * compile-time error in the format package. Vendor extensions under
 * `_x.viritura.*` are deliberately untyped per the MNX schema.
 *
 * See {@link ./validator} for the runtime guard and
 * {@link @viritura/core/raw} for the wire-shape types.
 */

import type { Score } from "@viritura/core";

import type { Root } from "@viritura/core/raw";
import { parseMnxWithDiagnostics, type ParseMnxOptions, type ParseMnxResult } from "./parser";
import { assertRawScore } from "./validator";

/**
 * Semantic alias for the root MNX document type emitted by
 * {@link @viritura/core/raw}. Use this name in public-facing code so
 * callers don't depend on the openapi-typescript "Root" wording.
 */
export type RawScore = Root;

/** Options accepted by {@link promoteWithDiagnostics}. */
export type PromoteOptions = ParseMnxOptions;

/** Result returned by {@link promoteWithDiagnostics}. */
export type PromoteResult = ParseMnxResult;

/**
 * Promote a Raw MNX document to the decoded {@link Score} model.
 *
 * @param raw - A document matching the Raw MNX wire shape (see
 *   {@link RawScore}). If you have an `unknown` JSON value instead, use
 *   {@link promoteUnknown} (or `parseMnx`), which run the runtime guard
 *   and then delegate here.
 */
export function promote(raw: RawScore): Score {
  return promoteWithDiagnostics(raw).score;
}

/**
 * Validate `json` against the MNX JSON Schema and promote it to the
 * decoded {@link Score} model. This is the explicit validate+promote
 * sandwich for callers that hold an `unknown` value at the boundary
 * (e.g. freshly-parsed JSON from disk or HTTP).
 *
 * @throws {RawScoreValidationFailure} If `json` does not match the MNX
 *   schema. The thrown error carries the full diagnostic list.
 */
export function promoteUnknown(json: unknown): Score {
  assertRawScore(json);
  return promote(json);
}

/**
 * Promote a Raw MNX document and collect diagnostics about lossy or
 * inferred conversions.
 */
export function promoteWithDiagnostics(raw: RawScore, options: PromoteOptions = {}): PromoteResult {
  // The Raw type is a structural superset of what the existing parser
  // accepts (it just adds typing on top of plain JSON). Forwarding through
  // `unknown` keeps the wire types and parser internals decoupled.
  return parseMnxWithDiagnostics(raw as unknown, options);
}

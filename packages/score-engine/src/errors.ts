/**
 * Typed errors for @viritura/score-engine.
 *
 * Public consumers can `instanceof`-check these to differentiate failure
 * modes without parsing error message strings.
 */

/** Engine asset (WASM, font) failed to load. */
export class EngineLoadError extends Error {
  override readonly name = "EngineLoadError";
  constructor(
    message: string,
    /** What failed to load: `wasm`, `font`, or `unknown`. */
    public readonly code: "wasm" | "font" | "unknown",
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Input MNX could not be parsed (malformed JSON or invalid schema). */
export class ParseError extends Error {
  override readonly name = "ParseError";
  constructor(
    message: string,
    /** Reason: `json` (syntax), `schema` (shape), or `unsupported` (unknown feature). */
    public readonly code: "json" | "schema" | "unsupported",
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Layout engine failed (typically WASM panic or out-of-memory). */
export class LayoutError extends Error {
  override readonly name = "LayoutError";
  constructor(
    message: string,
    /** Reason: `wasm` (engine panic), `oom`, or `unknown`. */
    public readonly code: "wasm" | "oom" | "unknown",
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

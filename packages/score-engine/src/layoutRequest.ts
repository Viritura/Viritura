/** Translation of public layout options into engine calls, shared by main thread and worker. */

import { LayoutError, ParseError } from "./errors";
import type { LayoutOptions } from "./types";

export interface LayoutArgs {
  readonly json: string;
  readonly spatium: number;
  readonly pageWidth: number;
  readonly scoreIndex: number;
  readonly pageSetupJson: string | undefined;
}

export function mnxJson(mnx: string | object): string {
  if (typeof mnx === "string") return mnx;
  try {
    return JSON.stringify(mnx);
  } catch (err) {
    throw new ParseError(`MNX input is not JSON-serializable: ${messageOf(err)}`, "json", err);
  }
}

export function layoutArgs(mnx: string | object, opts: LayoutOptions): LayoutArgs {
  const spatium = opts.spatium ?? 7;
  if (!(spatium > 0)) throw new RangeError(`spatium must be positive, got ${spatium}`);
  const setup = opts.pageSetup;
  return {
    json: mnxJson(mnx),
    spatium,
    pageWidth: opts.pageWidth,
    scoreIndex: opts.scoreIndex ?? 0,
    // The engine takes page geometry in staff spaces.
    pageSetupJson: setup
      ? JSON.stringify({
          page_height: setup.height / spatium,
          page_margin_top: setup.margins.top / spatium,
          page_margin_right: setup.margins.right / spatium,
          page_margin_bottom: setup.margins.bottom / spatium,
          page_margin_left: setup.margins.left / spatium,
        })
      : undefined,
  };
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Classify a raw engine failure. The Rust engine reports errors as strings. */
export function layoutFailure(err: unknown): ParseError | LayoutError {
  if (err instanceof ParseError || err instanceof LayoutError) return err;
  const msg = messageOf(err);
  if (/parse|json|schema|missing field|expected|invalid type|unknown variant/i.test(msg)) {
    return new ParseError(`Failed to parse MNX: ${msg}`, "schema", err);
  }
  if (/out of memory|memory access|allocation/i.test(msg)) {
    return new LayoutError(`Layout failed: ${msg}`, "oom", err);
  }
  return new LayoutError(`Layout failed: ${msg}`, "wasm", err);
}

import type { Score } from "@viritura/core";
import { parseMnxUnvalidated } from "./parserCore";
import { assertRawScore } from "./validator";

/** Validate MNX against the schema before building its Score model. */
export function parseMnx(json: unknown): Score {
  assertRawScore(json);
  return parseMnxUnvalidated(json);
}

import type { Score } from "@viritura/core";
import { parseMnxUnvalidated } from "./parserCore";
import { migrateLegacyTextContent } from "./legacyTextContent";
import { assertRawScore } from "./validator";

/** Validate MNX against the schema before building its Score model. */
export function parseMnx(json: unknown): Score {
  // Legacy plain-string text content predates the array-only schema, so it is
  // widened before validation rather than being rejected as invalid.
  const migrated = migrateLegacyTextContent(json);
  assertRawScore(migrated);
  return parseMnxUnvalidated(migrated);
}

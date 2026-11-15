import type { Score } from "@viritura/core";
import { parseMnxUnvalidated } from "./parserCore";
import { migrateLegacyStaffSymbols } from "./legacyStaffSymbols";
import { migrateLegacyTextContent } from "./legacyTextContent";
import { assertRawScore } from "./validator";

/** Validate MNX against the schema before building its Score model. */
export function parseMnx(json: unknown): Score {
  // Legacy plain-string text content and non-MNX staff-group symbols predate
  // the current schema, so they are upgraded before validation rather than
  // being rejected as invalid.
  const migrated = migrateLegacyStaffSymbols(migrateLegacyTextContent(json));
  assertRawScore(migrated);
  return parseMnxUnvalidated(migrated);
}

import type { Score } from "@viritura/core";
import { parseMnxWithDiagnostics, type ParseMnxOptions } from "./parserCore";
import { migrateLegacyStaffSymbols } from "./legacyStaffSymbols";
import { migrateLegacyTextContent } from "./legacyTextContent";
import { assertRawScore } from "./validator";

/** Validate MNX before building its Score model, optionally retaining import diagnostics. */
export function parseMnx(json: unknown, options: Pick<ParseMnxOptions, "diagnostics"> = {}): Score {
  // Legacy plain-string text content and non-MNX staff-group symbols predate
  // the current schema, so they are upgraded before validation rather than
  // being rejected as invalid.
  const migrated = migrateLegacyStaffSymbols(migrateLegacyTextContent(json));
  assertRawScore(migrated);
  return parseMnxWithDiagnostics(migrated, options).score;
}

import type { Score } from "@viritura/core";
import { parseMnxUnvalidated } from "./parserCore";
import { migrateLegacyTextContent } from "./legacyTextContent";
import { assertRawScore, RawScoreValidationFailure } from "./validator";

/** Validate MNX against the schema before building its Score model. */
export function parseMnx(json: unknown): Score {
  // Legacy plain-string text content predates the array-only schema, so it is
  // widened before validation rather than being rejected as invalid.
  const migrated = migrateLegacyTextContent(json);
  validateNoteMarkings(migrated);
  // This source branch may carry pre-v46 generated validators. Remove only
  // the handwritten v46 note-marking fields for that schema check; their
  // complete shape is checked above and the original value is promoted.
  assertRawScore(withoutNoteMarkings(migrated));
  return parseMnxUnvalidated(migrated);
}

function validateNoteMarkings(value: unknown): void {
  const errors: Array<{ pointer: string; message: string; keyword: string }> = [];
  const walk = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((child, index) => walk(child, `${path}/${index}`));
      return;
    }
    if (!isRecord(current)) return;
    const notes = current["notes"];
    if (Array.isArray(notes)) {
      notes.forEach((note, index) => {
        if (!isRecord(note) || note["markings"] === undefined) return;
        const markings = note["markings"];
        const notePath = `${path}/notes/${index}/markings`;
        if (!isRecord(markings) || Object.keys(markings).some((key) => key !== "slideIn" && key !== "slideOut")) {
          errors.push({ pointer: notePath, message: "must contain slideIn and/or slideOut objects", keyword: "type" });
          return;
        }
        for (const [key, allowed] of [
          ["slideIn", ["scoop", "plop"]],
          ["slideOut", ["falloff", "doit"]],
        ] as const) {
          const marking = markings[key];
          if (marking === undefined) continue;
          const pointer = `${notePath}/${key}`;
          if (
            !isRecord(marking) ||
            typeof marking["type"] !== "string" ||
            !allowed.some((type) => type === marking["type"])
          ) {
            errors.push({ pointer, message: `type must be one of ${allowed.join(", ")}`, keyword: "enum" });
            continue;
          }
          const invalidMetadata = Object.keys(marking).some((field) => !["type", "id", "_c", "_x"].includes(field));
          if (
            invalidMetadata ||
            (marking["id"] !== undefined && typeof marking["id"] !== "string") ||
            (marking["_c"] !== undefined && typeof marking["_c"] !== "string") ||
            (marking["_x"] !== undefined && !isRecord(marking["_x"]))
          ) {
            errors.push({ pointer, message: "contains invalid global attributes", keyword: "additionalProperties" });
          }
        }
      });
    }
    for (const [key, child] of Object.entries(current)) {
      if (key !== "notes") walk(child, `${path}/${key}`);
    }
  };
  walk(value, "");
  if (errors.length > 0) throw new RawScoreValidationFailure(errors);
}

function withoutNoteMarkings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNoteMarkings);
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "notes" && Array.isArray(child)) {
      copy[key] = child.map((note) => {
        if (!isRecord(note)) return withoutNoteMarkings(note);
        const { markings: _markings, ...withoutMarkings } = note;
        return withoutNoteMarkings(withoutMarkings);
      });
    } else {
      copy[key] = withoutNoteMarkings(child);
    }
  }
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

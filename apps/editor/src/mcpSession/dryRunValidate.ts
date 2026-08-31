/**
 * Dry-run validation backing the `score.validate` MCP tool.
 *
 * A model can check a patch array or a whole MNX document WITHOUT staging a
 * proposal (and therefore without spending a human approval). It reuses the
 * exact validation path a real proposal goes through —
 * `applyPatchesToScore` → `serializeMnx` → `parseMnx` (which runs
 * `assertRawScore` and throws) — so a clean result here means the same input
 * would stage cleanly.
 */

import { applyPatchesToScore, type Score, type ScorePatch } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";

interface ValidationResult {
  valid: boolean;
  mode: "patches" | "document";
  /** Human-readable diagnostics; empty when `valid` is true. */
  diagnostics: string[];
}

export function validateScoreInput(score: Score, args: unknown): ValidationResult {
  const input = isObject(args) ? args : {};
  const hasPatches = Array.isArray(input.patches);
  const hasMnx = input.mnx !== undefined;
  if (hasPatches === hasMnx) {
    throw new Error("Provide exactly one of `patches` (an array) or `mnx` (a document).");
  }

  if (hasPatches) {
    return validatePatches(score, input.patches as unknown[]);
  }
  return validateDocument(input.mnx);
}

function validatePatches(score: Score, rawPatches: unknown[]): ValidationResult {
  if (rawPatches.length === 0) {
    return { valid: false, mode: "patches", diagnostics: ["patches must contain at least one ScorePatch."] };
  }
  if (!rawPatches.every((patch) => isObject(patch) && typeof patch.kind === "string")) {
    return { valid: false, mode: "patches", diagnostics: ["Every patch must be an object with a kind discriminator."] };
  }
  try {
    const proposedScore = applyPatchesToScore(score, structuredClone(rawPatches) as ScorePatch[]);
    parseMnx(serializeMnx(proposedScore));
    return { valid: true, mode: "patches", diagnostics: [] };
  } catch (error) {
    return { valid: false, mode: "patches", diagnostics: [messageOf(error)] };
  }
}

function validateDocument(mnx: unknown): ValidationResult {
  try {
    const document = typeof mnx === "string" ? (JSON.parse(mnx) as unknown) : structuredClone(mnx);
    parseMnx(document);
    return { valid: true, mode: "document", diagnostics: [] };
  } catch (error) {
    return { valid: false, mode: "document", diagnostics: [messageOf(error)] };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

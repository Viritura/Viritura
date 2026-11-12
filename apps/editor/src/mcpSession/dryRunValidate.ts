/**
 * Dry-run validation backing the `score.validate` MCP tool.
 *
 * A model can check a patch array or a whole MNX document WITHOUT staging a
 * proposal (and therefore without spending a human approval). The preview
 * follows the editor's beat-count repair and reports its effects
 * before anything is staged.
 */

import type { Score } from "@viritura/core";
import { parseMnx } from "@viritura/format";
import { previewPatches, previewRepairs } from "./patchPreview";
import { readScorePatches } from "./scorePatches";

interface ValidationResult {
  valid: boolean;
  mode: "patches" | "document";
  /** Human-readable diagnostics; empty when `valid` is true. */
  diagnostics: string[];
  repairs?: ReturnType<typeof previewRepairs>["repairs"];
  requiresRhythmTruncationApproval?: boolean;
  splicePreviews?: ReturnType<typeof previewPatches>["splicePreviews"];
  splicePreviewsTruncated?: boolean;
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
  if (rawPatches.length === 0 || rawPatches.length > 4096) {
    return { valid: false, mode: "patches", diagnostics: ["patches must contain 1 to 4096 ScorePatch objects."] };
  }
  try {
    const patches = readScorePatches(rawPatches);
    const preview = previewPatches(score, patches);
    return {
      valid: preview.remainingIssues.length === 0,
      mode: "patches",
      diagnostics: preview.remainingIssues.length ? ["Some rhythmic issues could not be repaired."] : [],
      repairs: preview.repairs,
      requiresRhythmTruncationApproval: preview.repairs.some((repair) => repair.action === "truncate"),
      splicePreviews: preview.splicePreviews,
      splicePreviewsTruncated: preview.splicePreviewsTruncated,
    };
  } catch (error) {
    return { valid: false, mode: "patches", diagnostics: [messageOf(error)] };
  }
}

function validateDocument(mnx: unknown): ValidationResult {
  try {
    const document = typeof mnx === "string" ? (JSON.parse(mnx) as unknown) : structuredClone(mnx);
    const preview = previewRepairs(parseMnx(document));
    return {
      valid: preview.remainingIssues.length === 0,
      mode: "document",
      diagnostics: preview.remainingIssues.length ? ["Some rhythmic issues could not be repaired."] : [],
      repairs: preview.repairs,
      requiresRhythmTruncationApproval: preview.repairs.some((repair) => repair.action === "truncate"),
    };
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

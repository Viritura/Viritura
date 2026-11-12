import type { Part, Score } from "@viritura/core";

export function selectParts(score: Score, value: unknown): Part[] {
  if (value === undefined) return score.parts;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("partIds must be an array of part ID strings.");
  }
  const requested = new Set<string>(value);
  const parts = score.parts.filter((part) => part.id !== undefined && requested.has(part.id));
  const found = new Set(parts.map((part) => part.id));
  const missing = [...requested].filter((id) => !found.has(id));
  if (missing.length) throw new Error(`Unknown partIds: ${missing.join(", ")}`);
  return parts;
}

export function pagination(offset: unknown, limit: unknown, maxLimit = 200): { offset: number; limit: number } {
  const start = offset === undefined ? 0 : offset;
  const size = limit === undefined ? Math.min(50, maxLimit) : limit;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    throw new Error("offset must be a non-negative integer.");
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > maxLimit) {
    throw new Error(`limit must be an integer from 1 to ${String(maxLimit)}.`);
  }
  return { offset: start, limit: size };
}

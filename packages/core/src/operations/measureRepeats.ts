/**
 * Measure repeats (simile marks) for playback and interchange.
 *
 * MNX puts a `measureRepeat` on the FIRST bar it covers and says "repeat all
 * music in the previous N measures". The covered bars carry no encoding of
 * their own and normally hold empty sequences, so playback has to substitute
 * the source material back in before anything downstream (notes, ties,
 * dynamics, holds) can see it.
 *
 * Substitution is deep-cloned with rewritten ids so a repeated bar does not
 * collide with its source in id-keyed lookups such as tie resolution.
 */

import type { Part, PartMeasure, Score } from "../model";

const REFERENCE_FIELDS = new Set(["target", "start", "end", "startNote", "endNote", "measure", "measureId", "eventId"]);

/** Rewrite every defined id in one clone and add it to the span-wide map. */
function rewriteIds(node: unknown, suffix: string, remap: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteIds(item, suffix, remap);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record["id"] === "string") {
    const original = record["id"];
    const next = `${original}${suffix}`;
    remap.set(original, next);
    record["id"] = next;
  }
  for (const value of Object.values(record)) rewriteIds(value, suffix, remap);
}

/** Relink every string reference that names an id cloned in this repeat span. */
function relinkIds(node: unknown, remap: ReadonlyMap<string, string>): void {
  if (Array.isArray(node)) {
    for (const item of node) relinkIds(item, remap);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "id") continue;
    if (typeof value === "string" && REFERENCE_FIELDS.has(key)) {
      const mapped = remap.get(value);
      if (mapped !== undefined) record[key] = mapped;
    } else if (key === "events" && Array.isArray(value)) {
      record[key] = value.map((reference: unknown) =>
        typeof reference === "string" ? (remap.get(reference) ?? reference) : reference,
      );
    } else {
      relinkIds(value, remap);
    }
  }
}

/**
 * Expand a part's simile marks into playable measures.
 *
 * Returns the part unchanged when it has no measure repeats, so the common
 * case costs one scan and no allocation.
 */
export function expandMeasureRepeats(part: Part, measureIds?: readonly (string | undefined)[]): Part {
  if (!part.measures.some((measure) => measure.measureRepeat)) return part;

  const measures = [...part.measures];
  for (let start = 0; start < part.measures.length; start++) {
    const repeat = part.measures[start]?.measureRepeat;
    if (!repeat) continue;
    const span = Math.max(1, Math.trunc(repeat.number));
    if (start < span) continue;

    const clones: Array<{ destination: number; origin: number; measure: PartMeasure }> = [];
    for (let offset = 0; offset < span && start + offset < part.measures.length; offset++) {
      const destination = start + offset;
      const originIndex = start - span + offset;
      const origin = measures[originIndex];
      if (origin) clones.push({ destination, origin: originIndex, measure: structuredClone(origin) });
    }

    // Build one remap for the complete repeated span before relinking. This is
    // what keeps cross-barline ties/slurs/glissandos inside the new iteration.
    const remap = new Map<string, string>();
    for (const clone of clones) {
      rewriteIds(clone.measure, `~r${clone.destination}`, remap);
      const sourceId = measureIds?.[clone.origin];
      const targetId = measureIds?.[clone.destination];
      if (sourceId !== undefined && targetId !== undefined) remap.set(sourceId, targetId);
    }
    for (const clone of clones) {
      relinkIds(clone.measure, remap);
      delete clone.measure.measureRepeat;
      measures[clone.destination] = clone.measure;
    }
    start += span - 1;
  }

  return { ...part, measures };
}

/**
 * Expand every part's simile marks so downstream passes see real music where a
 * measure repeat stands. Returns the score unchanged when no part has one.
 */
export function expandScoreMeasureRepeats(score: Score): Score {
  const parts = score.parts.map((part) =>
    expandMeasureRepeats(
      part,
      score.global.measures.map((measure) => measure.id),
    ),
  );
  if (parts.every((part, index) => part === score.parts[index])) return score;
  return { ...score, parts };
}

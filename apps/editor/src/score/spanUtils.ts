/**
 * Reusable utilities for creating span items (hairpins, pedals, ottavas, etc.)
 * that have a start position in one measure and an end position in another.
 *
 * In MNX, span items reference their end measure by ID string
 * (MeasureRhythmicPosition.measure). This module ensures measures have
 * stable IDs and derives correct start/end info from the current selection.
 */
import type { Score, MeasureRhythmicPosition, RhythmicPosition } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import { resolveSelectionMeasureRange } from "../store/selectionUtils";
import { resolveEventLocation } from "./ElementPath";
import { sequenceContentBeats } from "../commands/noteCommands";

// ═══════════════════════════════════════════
// Measure ID management
// ═══════════════════════════════════════════

/**
 * Ensure a global measure at `index` has an `id` field.
 * If missing, generates one like `"m0"`, `"m1"`, etc., avoiding collisions.
 * Mutates the score in place and returns the ID.
 */
export function ensureMeasureId(score: Score, index: number): string {
  const measure = score.global.measures[index];
  if (!measure) throw new Error(`Measure index ${index} out of range`);
  if (measure.id) return measure.id;

  // Collect existing IDs to avoid collision
  const existing = new Set<string>();
  for (const m of score.global.measures) {
    if (m.id) existing.add(m.id);
  }

  // Generate a unique ID
  let candidate = `m${index}`;
  let suffix = 0;
  while (existing.has(candidate)) {
    candidate = `m${index}_${suffix++}`;
  }
  measure.id = candidate;
  return candidate;
}

/**
 * Ensure all measures in a range have IDs. Returns the score (mutated in place).
 */
export function ensureMeasureIdsInRange(score: Score, startIndex: number, endIndex: number): void {
  for (let i = startIndex; i <= endIndex && i < score.global.measures.length; i++) {
    ensureMeasureId(score, i);
  }
}

// ═══════════════════════════════════════════
// Rhythmic position computation
// ═══════════════════════════════════════════

/**
 * Greatest common divisor for fraction reduction.
 */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/**
 * Compute the rhythmic position (fraction of a whole note) of an event at
 * a given index within a sequence, by summing the durations of all preceding
 * content items.
 */
function computeEventPosition(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
): RhythmicPosition {
  const sequence = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!sequence) return { fraction: [0, 1] };

  let beatSum = 0;
  for (let i = 0; i < eventIndex && i < sequence.content.length; i++) {
    beatSum += sequenceContentBeats(sequence.content[i]!);
  }

  // MNX positions are fractions of a whole note.
  // A quarter note = 1 beat = 1/4 of a whole note.
  const numerator = Math.round(beatSum * 256);
  const denominator = 1024;
  const g = gcd(numerator, denominator);
  return { fraction: [numerator / g, denominator / g] };
}

/**
 * Compute the rhythmic position at the END of an event (start + duration).
 */
function computeEventEndPosition(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
): RhythmicPosition {
  const sequence = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!sequence) return { fraction: [1, 1] };

  let beatSum = 0;
  for (let i = 0; i <= eventIndex && i < sequence.content.length; i++) {
    beatSum += sequenceContentBeats(sequence.content[i]!);
  }

  const numerator = Math.round(beatSum * 256);
  const denominator = 1024;
  const g = gcd(numerator, denominator);
  return { fraction: [numerator / g, denominator / g] };
}

// ═══════════════════════════════════════════
// Span endpoint resolution
// ═══════════════════════════════════════════

/**
 * Information needed to create a span item (hairpin, pedal, ottava, etc.)
 * from the current selection.
 */
export interface SpanEndpoints {
  /** Measure index where the span starts (item lives on this measure's part). */
  startMeasureIndex: number;
  /** Part index for the span. */
  partIndex: number;
  /** Start rhythmic position within the start measure. */
  startPosition: RhythmicPosition;
  /** End measure-rhythmic-position (measure ID + position within that measure). */
  endPosition: MeasureRhythmicPosition;
}

/**
 * Extract measure index from an element ID (e.g., "p0/m2/s0/ev1" → 2).
 */
function measureIndexFromElementId(elementId: string): number | null {
  const match = elementId.match(/(?:^|\/)m(\d+)(?:\/|$)/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/**
 * Extract part index from an element ID (e.g., "p1/m0/s0/ev0" → 1).
 */
function partIndexFromElementId(elementId: string): number | null {
  const match = elementId.match(/(?:^|\/)p(\d+)(?:\/|$)/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/**
 * Resolve span start/end from the current selection.
 *
 * - **Single selection:** Span covers just that one measure (start of bar → end of bar).
 * - **Range selection:** Span starts at the beginning of the first selected measure
 *   and ends at the end of the last selected measure.
 *
 * Automatically assigns measure IDs where needed so the end reference is valid.
 * Mutates the score to add IDs — caller should pass a cloned score.
 */
export function resolveSpanFromSelection(score: Score, selection: Selection): SpanEndpoints | null {
  if (selection.kind === "none") {
    return null;
  }

  if (selection.kind === "single") {
    // Try to get precise event location for accurate position
    const eventLoc = resolveEventLocation(selection.elementId, score);
    if (eventLoc) {
      const endMeasureId = ensureMeasureId(score, eventLoc.measureIndex);
      const startPos = computeEventPosition(
        score,
        eventLoc.partIndex,
        eventLoc.measureIndex,
        eventLoc.sequenceIndex,
        eventLoc.eventIndex,
      );
      const result = {
        startMeasureIndex: eventLoc.measureIndex,
        partIndex: eventLoc.partIndex,
        startPosition: startPos,
        endPosition: {
          measure: endMeasureId,
          position: { fraction: [1, 1] as [number, number] },
        },
      };
      return result;
    }

    // Fallback: parse measure/part from element ID
    const measureIdx = measureIndexFromElementId(selection.elementId);
    if (measureIdx === null || measureIdx >= score.global.measures.length) {
      return null;
    }
    const partIdx = partIndexFromElementId(selection.elementId) ?? 0;
    const endMeasureId = ensureMeasureId(score, measureIdx);

    return {
      startMeasureIndex: measureIdx,
      partIndex: partIdx,
      startPosition: { fraction: [0, 1] },
      endPosition: {
        measure: endMeasureId,
        position: { fraction: [1, 1] },
      },
    };
  }

  if (selection.kind !== "range") {
    return null;
  }

  // Range selection — parse both element IDs for precise positioning
  const startLoc = resolveEventLocation(selection.startElementId, score);
  const endLoc = resolveEventLocation(selection.endElementId, score);

  if (startLoc && endLoc) {
    // Ensure start <= end measure ordering
    const [firstLoc, lastLoc] = startLoc.measureIndex <= endLoc.measureIndex ? [startLoc, endLoc] : [endLoc, startLoc];

    ensureMeasureIdsInRange(score, firstLoc.measureIndex, lastLoc.measureIndex);
    const endMeasureId = ensureMeasureId(score, lastLoc.measureIndex);

    const startPos = computeEventPosition(
      score,
      firstLoc.partIndex,
      firstLoc.measureIndex,
      firstLoc.sequenceIndex,
      firstLoc.eventIndex,
    );
    const endPos = computeEventEndPosition(
      score,
      lastLoc.partIndex,
      lastLoc.measureIndex,
      lastLoc.sequenceIndex,
      lastLoc.eventIndex,
    );

    return {
      startMeasureIndex: firstLoc.measureIndex,
      partIndex: firstLoc.partIndex,
      startPosition: startPos,
      endPosition: {
        measure: endMeasureId,
        position: endPos,
      },
    };
  }

  // Fallback: use measure range resolution (less precise, measure-level only)
  const range = resolveSelectionMeasureRange(selection.startElementId, selection.endElementId, score);

  if (range) {
    const partIdx = range.startPart;
    ensureMeasureIdsInRange(score, range.startMeasure, range.endMeasure);
    const endMeasureId = ensureMeasureId(score, range.endMeasure);

    return {
      startMeasureIndex: range.startMeasure,
      partIndex: partIdx,
      startPosition: { fraction: [0, 1] },
      endPosition: {
        measure: endMeasureId,
        position: { fraction: [1, 1] },
      },
    };
  }

  // Last resort: parse element IDs loosely
  const startIdx = measureIndexFromElementId(selection.startElementId);
  const endIdx = measureIndexFromElementId(selection.endElementId);
  if (startIdx === null || endIdx === null) return null;

  const first = Math.min(startIdx, endIdx);
  const last = Math.max(startIdx, endIdx);
  if (first >= score.global.measures.length) return null;
  const clampedLast = Math.min(last, score.global.measures.length - 1);

  const partIdx = partIndexFromElementId(selection.startElementId) ?? 0;
  ensureMeasureIdsInRange(score, first, clampedLast);
  const endMeasureId = ensureMeasureId(score, clampedLast);

  return {
    startMeasureIndex: first,
    partIndex: partIdx,
    startPosition: { fraction: [0, 1] },
    endPosition: {
      measure: endMeasureId,
      position: { fraction: [1, 1] },
    },
  };
}

/**
 * Duration / rest decomposition math + ID generation.
 *
 * Extracted from noteCommands.ts; re-exported from there for backwards compatibility.
 */

import type { Duration, NoteEvent, NoteValueBase, SequenceContent } from "@viritura/core";
import { DURATION_BEATS, generateId } from "@viritura/core";

// ═══════════════════════════════════════════
// Duration math helpers
// ═══════════════════════════════════════════

/** Convert a Duration to quarter-note beats. */
export function durationToBeats(d: Duration): number {
  let beats = DURATION_BEATS[d.base];
  let dotValue = beats / 2;
  for (let i = 0; i < (d.dots ?? 0); i++) {
    beats += dotValue;
    dotValue /= 2;
  }
  return beats;
}

/** Try to express `beats` as a single Duration (with up to 2 dots). */
function singleDurationFor(beats: number): Duration | null {
  const bases: NoteValueBase[] = [
    "duplexMaxima",
    "maxima",
    "longa",
    "breve",
    "whole",
    "half",
    "quarter",
    "eighth",
    "16th",
    "32nd",
    "64th",
    "128th",
    "256th",
    "512th",
    "1024th",
    "2048th",
    "4096th",
  ];
  for (const base of bases) {
    const baseB = DURATION_BEATS[base];
    if (Math.abs(baseB - beats) < 1e-9) return { base };
    if (Math.abs(baseB * 1.5 - beats) < 1e-9) return { base, dots: 1 };
    if (Math.abs(baseB * 1.75 - beats) < 1e-9) return { base, dots: 2 };
  }
  return null;
}

/** Find the largest NoteValueBase that fits within the given beat count. */
export function beatsToNoteValueBase(beats: number): NoteValueBase {
  const bases: NoteValueBase[] = [
    "duplexMaxima",
    "maxima",
    "longa",
    "breve",
    "whole",
    "half",
    "quarter",
    "eighth",
    "16th",
    "32nd",
    "64th",
    "128th",
    "256th",
    "512th",
    "1024th",
    "2048th",
    "4096th",
  ];
  for (const base of bases) {
    if (DURATION_BEATS[base] <= beats + 1e-9) {
      return base;
    }
  }
  return "4096th";
}

/** Express `beats` as one exact note value, including up to four dots. */
export function beatsToDuration(beats: number): Duration | null {
  const bases: NoteValueBase[] = [
    "duplexMaxima",
    "maxima",
    "longa",
    "breve",
    "whole",
    "half",
    "quarter",
    "eighth",
    "16th",
    "32nd",
    "64th",
    "128th",
    "256th",
    "512th",
    "1024th",
    "2048th",
    "4096th",
  ];
  for (const base of bases) {
    let multiplier = 1;
    for (let dots = 0; dots <= 4; dots++) {
      if (Math.abs(DURATION_BEATS[base] * multiplier - beats) < 1e-9) {
        return dots === 0 ? { base } : { base, dots };
      }
      multiplier += 1 / 2 ** (dots + 1);
    }
  }
  return null;
}

/**
 * Decompose a beat count into a sequence of durations (including dotted).
 * Returns durations from largest to smallest that sum to the given beats.
 */
export function decomposeDuration(beats: number): Duration[] {
  const result: Duration[] = [];
  let remaining = beats;
  while (remaining > 1e-9) {
    const base = beatsToNoteValueBase(remaining);
    const baseBeats = DURATION_BEATS[base];
    const doubleDotted = baseBeats * 1.75;
    const singleDotted = baseBeats * 1.5;
    if (doubleDotted <= remaining + 1e-9) {
      result.push({ base, dots: 2 });
      remaining -= doubleDotted;
    } else if (singleDotted <= remaining + 1e-9) {
      result.push({ base, dots: 1 });
      remaining -= singleDotted;
    } else {
      result.push({ base });
      remaining -= baseBeats;
    }
  }
  return result;
}

/**
 * Maximum beats of a single rest that may start at `pos` in a measure whose
 * beat unit is `beatUnit`, limited by `remaining`.
 */
function maxRestLengthAt(pos: number, remaining: number, beatUnit: number): number {
  const units = pos / beatUnit;
  const onGrid = Math.abs(units - Math.round(units)) < 1e-9;
  if (!onGrid) {
    const nextBeat = Math.ceil(units + 1e-9) * beatUnit;
    return Math.min(nextBeat - pos, remaining);
  }
  const strength = metricBoundaryStrength(pos, beatUnit);
  if (!isFinite(strength)) return remaining;
  return Math.min(strength, remaining);
}

/**
 * Strength (in beats) of a beat-grid-aligned position: the largest power-of-2
 * multiple of `beatUnit` that evenly divides `pos`.  Bar start (pos ≈ 0) → ∞.
 */
function metricBoundaryStrength(pos: number, beatUnit: number): number {
  if (pos < 1e-9) return Infinity;
  let strength = beatUnit;
  let next = beatUnit * 2;
  while (Math.abs(pos / next - Math.round(pos / next)) < 1e-9) {
    strength = next;
    next *= 2;
    if (next > 1024) break;
  }
  return strength;
}

/**
 * Decompose `beats` of rest starting at `startBeat` within a measure described
 * by `ts`, respecting metric boundaries (standard engraving practice convention).
 */
export function decomposeRestsAtPosition(
  beats: number,
  startBeat: number,
  ts: import("@viritura/core").TimeSignature,
): Duration[] {
  if (beats <= 1e-9) return [];
  const beatUnit = 4 / ts.unit;
  const result: Duration[] = [];
  let remaining = beats;
  let pos = startBeat;

  while (remaining > 1e-9) {
    const maxLen = maxRestLengthAt(pos, remaining, beatUnit);
    const single = singleDurationFor(maxLen);
    if (single) {
      result.push(single);
      remaining -= maxLen;
      pos += maxLen;
    } else {
      const sub = decomposeDuration(maxLen);
      for (const d of sub) {
        result.push(d);
        pos += durationToBeats(d);
      }
      remaining -= maxLen;
    }
  }
  return result;
}

/**
 * Compute the real-time beats a SequenceContent item occupies.
 */
export function sequenceContentBeats(content: SequenceContent): number {
  switch (content.type) {
    case "event":
      return durationToBeats(content.duration);
    case "tuplet":
      return content.outer.multiple * durationToBeats(content.outer.duration);
    case "tremolo":
      return content.outer.multiple * durationToBeats(content.outer.duration);
    case "grace":
      return 0;
    case "space":
      return (content.duration[0] / content.duration[1]) * 4;
    default:
      return 0;
  }
}

// ═══════════════════════════════════════════
// ID generation
// ═══════════════════════════════════════════
//
// Thin wrappers around the canonical UUID v7 generator in @viritura/core.
// The named functions are kept so call sites continue to document intent
// ("creating an event id" vs "creating a note id") — there is no runtime
// distinction, both produce the same UUID v7 shape.

/** Generate a unique event ID (UUID v7). */
export function generateEventId(): string {
  return generateId();
}

/** Generate a unique note ID (UUID v7). */
export function generateNoteId(): string {
  return generateId();
}

/**
 * Legacy no-op kept for backward compatibility with tests that called this
 * to reset a counter-based generator. UUID v7 has no counter; there is
 * nothing to reset. Safe to remove once tests stop importing it.
 *
 * @deprecated Counter-based ID generation has been replaced with UUID v7.
 */
export function resetIdCounter(): void {
  // no-op
}

// ═══════════════════════════════════════════
// Helper: create rest event
// ═══════════════════════════════════════════

export function createRest(duration: Duration): NoteEvent {
  return {
    type: "event",
    id: generateEventId(),
    duration,
    rest: {},
  };
}

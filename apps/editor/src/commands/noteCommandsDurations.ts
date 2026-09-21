/**
 * Duration / rest decomposition math + ID generation.
 *
 * Extracted from noteCommands.ts; re-exported from there for backwards compatibility.
 */

import type { Duration, NoteEvent, NoteValueBase, SequenceContent } from "@viritura/core";
import { DURATION_BEATS, generateId, resolveMeter } from "@viritura/core";

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

function isCompoundMeter(beatStructure: readonly number[]): boolean {
  return beatStructure.length > 0 && beatStructure.every((group) => group === 3);
}

function decomposeUndottedDuration(beats: number): Duration[] {
  const result: Duration[] = [];
  let remaining = beats;
  while (remaining > 1e-9) {
    const base = beatsToNoteValueBase(remaining);
    result.push({ base });
    remaining -= DURATION_BEATS[base];
  }
  return result;
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
  const meter = resolveMeter(ts);
  const allowDots = isCompoundMeter(meter.beatStructure);
  const result: Duration[] = [];
  let remaining = beats;
  let pos = startBeat;

  while (remaining > 1e-9) {
    const nextBoundary = meter.beatBoundaries.find((boundary) => boundary > pos + 1e-9);
    const span = Math.min(nextBoundary === undefined ? remaining : nextBoundary - pos, remaining);
    const durations = allowDots ? decomposeDuration(span) : decomposeUndottedDuration(span);
    result.push(...durations);
    remaining -= span;
    pos += span;
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
    case "tuplet": {
      if (content.span) {
        const innerBeats = content.inner.multiple * durationToBeats(content.inner.duration);
        const outerBeats = content.outer.multiple * durationToBeats(content.outer.duration);
        const fragmentInnerBeats = content.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
        return innerBeats > 0 ? fragmentInnerBeats * (outerBeats / innerBeats) : 0;
      }
      return content.outer.multiple * durationToBeats(content.outer.duration);
    }
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

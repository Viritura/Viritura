import type { Score, TimeSignature } from "@viritura/core";
import { measureBeats } from "@viritura/core";
import { durationToBeats, sequenceContentBeats } from "./noteCommands";
import type { CursorPosition } from "../store/noteInputStore";

/**
 * Compute the number of beats used in a given measure/voice.
 */
export function computeUsedBeats(score: Score, measureIndex: number, partIndex: number, voice: number): number {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[voice];
  if (!seq) return 0;
  let beats = 0;
  for (const item of seq.content) {
    beats += sequenceContentBeats(item);
  }
  return beats;
}

/**
 * Resolve the active time signature at a given measure index by walking
 * backwards through global measures.
 */
export function getActiveTimeSignature(score: Score, measureIndex: number): TimeSignature {
  for (let m = measureIndex; m >= 0; m--) {
    const gm = score.global.measures[m];
    if (gm?.time) return gm.time;
  }
  return { count: 4, unit: 4 };
}

/**
 * Compute the cursor position at the end of existing content in
 * a given part/voice, starting from measure 0. Used when entering
 * note input mode to place cursor at the end of existing notes.
 */
export function computeEndOfContentCursor(score: Score, partIndex: number, voice: number): CursorPosition {
  // Walk backwards from last measure to find the last one with note (non-rest) content
  for (let m = score.global.measures.length - 1; m >= 0; m--) {
    const seq = score.parts[partIndex]?.measures[m]?.sequences[voice];
    if (!seq) continue;

    // Check if this measure has any note events (not just rests)
    let hasNotes = false;
    let usedBeats = 0;
    for (const item of seq.content) {
      if (item.type === "tuplet") {
        usedBeats += sequenceContentBeats(item);
        // Check if any inner event has notes
        for (const inner of item.content) {
          if (inner.type === "event" && inner.notes && inner.notes.length > 0) {
            hasNotes = true;
          }
        }
      } else if (item.type === "event") {
        usedBeats += durationToBeats(item.duration);
        if (item.notes && item.notes.length > 0) {
          hasNotes = true;
        }
      }
    }

    if (!hasNotes) continue;

    const ts = getActiveTimeSignature(score, m);
    const max = measureBeats(ts);
    if (usedBeats >= max - 1e-9) {
      // Full measure with notes — cursor goes to start of next measure
      if (m + 1 < score.global.measures.length) {
        return { measureIndex: m + 1, beatPosition: 0, partIndex };
      }
      return { measureIndex: m, beatPosition: max, partIndex };
    }
    // Partially filled — cursor at end of content
    return { measureIndex: m, beatPosition: usedBeats, partIndex };
  }
  // All measures empty (only rests) — start of measure 0
  return { measureIndex: 0, beatPosition: 0, partIndex };
}

/**
 * Advance a cursor position by the given number of beats,
 * crossing measure boundaries as needed.
 */
export function advanceCursor(score: Score, cursor: CursorPosition, beats: number): CursorPosition {
  let { measureIndex, beatPosition } = cursor;
  beatPosition += beats;

  const totalMeasures = score.global.measures.length;

  while (measureIndex < totalMeasures) {
    const ts = getActiveTimeSignature(score, measureIndex);
    const max = measureBeats(ts);
    if (beatPosition < max - 1e-9) {
      return { measureIndex, beatPosition, partIndex: cursor.partIndex, staffIndex: cursor.staffIndex };
    }
    // Beat is at or past the end of this measure — wrap to next
    beatPosition -= max;
    measureIndex++;
  }

  // Beyond last measure — return position past the end so auto-append can create new measures
  return {
    measureIndex,
    beatPosition: Math.max(0, beatPosition),
    partIndex: cursor.partIndex,
    staffIndex: cursor.staffIndex,
  };
}

/**
 * Move cursor left by one beat step (the given duration in beats).
 * Crosses measure boundaries backwards.
 */
export function moveCursorLeft(score: Score, cursor: CursorPosition, stepBeats: number): CursorPosition {
  let { measureIndex, beatPosition } = cursor;
  beatPosition -= stepBeats;

  while (beatPosition < -1e-9 && measureIndex > 0) {
    measureIndex--;
    const ts = getActiveTimeSignature(score, measureIndex);
    beatPosition += measureBeats(ts);
  }

  if (beatPosition < 0) beatPosition = 0;

  return { measureIndex, beatPosition, partIndex: cursor.partIndex, staffIndex: cursor.staffIndex };
}

/**
 * Move cursor right by one beat step (the given duration in beats).
 * Crosses measure boundaries forwards.
 */
export function moveCursorRight(score: Score, cursor: CursorPosition, stepBeats: number): CursorPosition {
  return advanceCursor(score, cursor, stepBeats);
}

/**
 * If the given (measureIndex, partIndex, voice, beatPosition) lies inside a
 * tuplet, return its real-time scale factor (outer / inner). Otherwise 1.
 *
 * Used to scale the notated step duration into the actual real-time beats
 * the cursor should advance by inside a tuplet — e.g. an eighth inside a
 * 3:2 triplet of eighths advances the cursor by 0.5 × 2/3 = 1/3 beat,
 * not 0.5.
 *
 * Per MNX spec: a tuplet's content occupies `outer.multiple × outer.duration`
 * beats of real time but is notated with values summing to
 * `inner.multiple × inner.duration`.
 */
export function getTupletScaleAt(
  score: Score,
  measureIndex: number,
  partIndex: number,
  voice: number,
  beatPosition: number,
): number {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[voice];
  if (!seq) return 1;
  let pos = 0;
  const eps = 1e-6;
  for (const item of seq.content) {
    const itemBeats = sequenceContentBeats(item);
    if (item.type === "tuplet") {
      // Cursor is inside the tuplet if its beat lies within [start, end).
      // We treat the start boundary as inside (you're about to enter the
      // first slot), and the end boundary as outside.
      if (beatPosition >= pos - eps && beatPosition < pos + itemBeats - eps) {
        const innerBeats = item.inner.multiple * durationToBeats(item.inner.duration);
        const outerBeats = item.outer.multiple * durationToBeats(item.outer.duration);
        if (innerBeats > 0) return outerBeats / innerBeats;
        return 1;
      }
    }
    pos += itemBeats;
  }
  return 1;
}

/**
 * Advance the cursor by a notated duration step, applying the tuplet scale
 * factor when the cursor lies inside a tuplet.
 *
 * Use this from note-input cursor handlers (note entry advance, Space,
 * Arrow keys) so that intra-tuplet steps land on the correct real-time
 * beat positions instead of overshooting the tuplet.
 */
export function advanceCursorByNotatedDuration(
  score: Score,
  cursor: CursorPosition,
  notatedBeats: number,
  voice: number,
  direction: 1 | -1 = 1,
): CursorPosition {
  const scale = getTupletScaleAt(score, cursor.measureIndex, cursor.partIndex, voice, cursor.beatPosition);
  const scaled = notatedBeats * scale;
  return direction > 0 ? advanceCursor(score, cursor, scaled) : moveCursorLeft(score, cursor, scaled);
}

function eventStartBeats(score: Score, measureIndex: number, partIndex: number, sequenceIndex: number): number[] {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return [];

  const starts: number[] = [];
  let beat = 0;
  for (const item of seq.content) {
    if (item.type === "tuplet") {
      const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
      const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
      for (const ev of item.content) {
        if (ev.type === "event") {
          starts.push(beat);
        }
        if (ev.type === "event") {
          beat += durationToBeats(ev.duration) * scale;
        }
      }
    } else if (item.type === "event") {
      starts.push(beat);
      beat += durationToBeats(item.duration);
    } else if (item.type === "tremolo") {
      // A multi-note tremolo occupies its outer duration as a single
      // cursor stop at its start beat — its alternating notes share that
      // beat range, so event-step navigation lands once at the front.
      starts.push(beat);
      beat += sequenceContentBeats(item);
    } else {
      beat += sequenceContentBeats(item);
    }
  }
  return starts;
}

/** Move cursor to the previous event start in the same sequence. */
export function moveCursorToPreviousEvent(score: Score, cursor: CursorPosition, sequenceIndex: number): CursorPosition {
  const eps = 1e-9;
  for (let m = cursor.measureIndex; m >= 0; m--) {
    const starts = eventStartBeats(score, m, cursor.partIndex, sequenceIndex);
    if (starts.length === 0) continue;
    const threshold = m === cursor.measureIndex ? cursor.beatPosition - eps : Number.POSITIVE_INFINITY;
    for (let i = starts.length - 1; i >= 0; i--) {
      const start = starts[i]!;
      if (start < threshold) {
        return { measureIndex: m, beatPosition: start, partIndex: cursor.partIndex, staffIndex: cursor.staffIndex };
      }
    }
  }
  return { measureIndex: 0, beatPosition: 0, partIndex: cursor.partIndex, staffIndex: cursor.staffIndex };
}

/** Move cursor to the next event start in the same sequence. */
export function moveCursorToNextEvent(score: Score, cursor: CursorPosition, sequenceIndex: number): CursorPosition {
  const eps = 1e-9;
  const totalMeasures = score.global.measures.length;
  for (let m = cursor.measureIndex; m < totalMeasures; m++) {
    const starts = eventStartBeats(score, m, cursor.partIndex, sequenceIndex);
    if (starts.length === 0) continue;
    const threshold = m === cursor.measureIndex ? cursor.beatPosition + eps : Number.NEGATIVE_INFINITY;
    for (const start of starts) {
      if (start > threshold) {
        return { measureIndex: m, beatPosition: start, partIndex: cursor.partIndex, staffIndex: cursor.staffIndex };
      }
    }
  }
  return cursor;
}

/** Move cursor to the start of the next measure. */
export function moveCursorToNextMeasure(score: Score, cursor: CursorPosition): CursorPosition {
  const lastMeasure = Math.max(0, score.global.measures.length - 1);
  return {
    measureIndex: Math.min(cursor.measureIndex + 1, lastMeasure),
    beatPosition: 0,
    partIndex: cursor.partIndex,
    staffIndex: cursor.staffIndex,
  };
}

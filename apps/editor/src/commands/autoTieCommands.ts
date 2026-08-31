/**
 * Auto-tie across-barline note insertion.
 *
 * Extracted from noteCommands.ts; public functions re-exported from there.
 */

import type { Duration, Note, Score, Sequence } from "@viritura/core";
import { appendMeasure, isRest, measureBeats } from "@viritura/core";
import {
  addNote,
  decomposeDuration,
  durationToBeats,
  ensureMeasureContent,
  generateEventId,
  getEffectiveTimeSignature,
  sequenceContentBeats,
  type AddNoteParams,
} from "./noteCommands";

// ═══════════════════════════════════════════
// Auto-tie across barlines
// ═══════════════════════════════════════════

export { ensureMeasureContent } from "./noteCommands";

/**
 * Find the note event at a specific beat position in a sequence
 * and return the last Note in it (the one most recently added).
 */
function findNoteAtBeat(sequence: Sequence, beatPos: number): Note | undefined {
  let pos = 0;
  for (const item of sequence.content) {
    if (item.type === "tuplet") {
      const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationToBeats(item.outer.duration) * item.outer.multiple;
      const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
      for (const ev of item.content) {
        if (ev.type === "event" && Math.abs(pos - beatPos) < 1e-9 && !isRest(ev) && ev.notes) {
          return ev.notes[ev.notes.length - 1];
        }
        if (ev.type === "event") {
          pos += durationToBeats(ev.duration) * scale;
        }
      }
    } else if (item.type === "event") {
      if (Math.abs(pos - beatPos) < 1e-9 && !isRest(item) && item.notes) {
        return item.notes[item.notes.length - 1];
      }
      pos += durationToBeats(item.duration);
    } else {
      pos += sequenceContentBeats(item);
    }
  }
  return undefined;
}

interface Fragment {
  measureIdx: number;
  beatPos: number;
  beats: number;
}

interface NotePiece {
  measureIdx: number;
  beatPos: number;
  duration: Duration;
  noteId: string;
}

/** Plan how the requested duration splits across measures. */
function planFragments(
  score: Score,
  measureIndex: number,
  beatPosition: number,
  totalBeats: number,
  remainingBeats: number,
): { fragments: Fragment[]; score: Score } {
  const fragments: Fragment[] = [];
  if (remainingBeats > 1e-9) {
    fragments.push({
      measureIdx: measureIndex,
      beatPos: beatPosition,
      beats: remainingBeats,
    });
  }
  let overflow = totalBeats - remainingBeats;
  let mIdx = measureIndex + 1;
  while (overflow > 1e-9) {
    while (mIdx >= score.global.measures.length) {
      score = appendMeasure(score);
    }
    const nextTS = getEffectiveTimeSignature(score, mIdx);
    const nextMB = measureBeats(nextTS);
    const fragBeats = Math.min(overflow, nextMB);
    fragments.push({ measureIdx: mIdx, beatPos: 0, beats: fragBeats });
    overflow -= fragBeats;
    mIdx++;
  }
  return { fragments, score };
}

/** Decompose fragments into individual note pieces with fresh IDs. */
function decomposeFragmentsIntoPieces(fragments: Fragment[]): NotePiece[] {
  const pieces: NotePiece[] = [];
  for (const frag of fragments) {
    const durs = decomposeDuration(frag.beats);
    let bp = frag.beatPos;
    for (const d of durs) {
      pieces.push({
        measureIdx: frag.measureIdx,
        beatPos: bp,
        duration: d,
        noteId: generateEventId(),
      });
      bp += durationToBeats(d);
    }
  }
  return pieces;
}

/**
 * Add a note at the specified beat position, automatically splitting across
 * barlines with ties if the duration exceeds the remaining beats in the measure.
 */
export function addNoteWithAutoTie(score: Score, params: AddNoteParams): Score {
  const { pitch, duration, measureIndex, partIndex, voice, beatPosition } = params;

  while (measureIndex >= score.global.measures.length) {
    score = appendMeasure(score);
  }

  if (params.kitComponent) {
    return addNote(score, params);
  }

  const timeSig = getEffectiveTimeSignature(score, measureIndex);
  const totalMeasureBeats = measureBeats(timeSig);
  const noteBeats = durationToBeats(duration);
  const remainingBeats = totalMeasureBeats - beatPosition;

  if (noteBeats <= remainingBeats + 1e-9) {
    return addNote(score, params);
  }

  const planned = planFragments(score, measureIndex, beatPosition, noteBeats, remainingBeats);
  score = planned.score;
  const pieces = decomposeFragmentsIntoPieces(planned.fragments);

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    if (piece.measureIdx !== measureIndex) {
      ensureMeasureContent(score, piece.measureIdx, partIndex, voice);
    }

    addNote(score, {
      pitch,
      duration: piece.duration,
      measureIndex: piece.measureIdx,
      partIndex,
      voice,
      beatPosition: piece.beatPos,
    });

    const seq = score.parts[partIndex]!.measures[piece.measureIdx]!.sequences[voice]!;
    const note = findNoteAtBeat(seq, piece.beatPos);
    if (note) {
      note.id = piece.noteId;
      if (i < pieces.length - 1) {
        note.ties = [{ target: pieces[i + 1]!.noteId }];
      }
    }
  }

  return score;
}

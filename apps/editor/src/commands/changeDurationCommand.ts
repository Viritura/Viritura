/**
 * changeDuration command — resize an existing event, possibly
 * consuming following content, inserting gap rests, or splitting
 * across barlines with ties.
 *
 * Extracted from noteCommands.ts; re-exported from there.
 *
 * NOTE: this function is a multi-branch state machine. It is grandfathered
 * in eslint.config.js for max-statements/complexity; decomposing it
 * further requires careful regression review of tied-note handling.
 */

import type { Note, NoteEvent, Score, Sequence } from "@viritura/core";
import { appendMeasure, isRest, measureBeats } from "@viritura/core";
import {
  createRest,
  decomposeDuration,
  decomposeRestsAtPosition,
  durationToBeats,
  generateEventId,
  generateNoteId,
  getEffectiveTimeSignature,
  mergeAdjacentRests,
  sequenceContentBeats,
  type ChangeDurationParams,
} from "./noteCommands";
import { ensureMeasureContent } from "./autoTieCommands";

/**
 * Find a Note by its ID within a specific measure/voice.
 * Searches the specified measure and the immediate previous one (covers tie chains).
 */
function findNoteById(
  score: Score,
  partIndex: number,
  measureIndex: number,
  voice: number,
  noteId: string,
): Note | undefined {
  for (let m = measureIndex; m >= Math.max(0, measureIndex - 1); m--) {
    const seq = score.parts[partIndex]?.measures[m]?.sequences[voice];
    if (!seq) continue;
    for (const ev of seq.content) {
      if (ev.type === "event" && ev.notes) {
        for (const note of ev.notes) {
          if (note.id === noteId) return note;
        }
      }
    }
  }
  return undefined;
}

/**
 * Consume (remove) content at a beat position to make room for new content.
 * Handles splitting events that partially overlap the consumed range.
 */
function consumeBeatsAt(sequence: Sequence, startBeat: number, beatsToConsume: number): void {
  let pos = 0;
  let i = 0;
  while (i < sequence.content.length && pos < startBeat - 1e-9) {
    pos += sequenceContentBeats(sequence.content[i]!);
    i++;
  }

  let remaining = beatsToConsume;
  const removeStart = i;
  let removeCount = 0;

  while (remaining > 1e-9 && removeStart + removeCount < sequence.content.length) {
    const ev = sequence.content[removeStart + removeCount]! as NoteEvent;
    const evBeats = sequenceContentBeats(ev);

    if (evBeats <= remaining + 1e-9) {
      remaining -= evBeats;
      removeCount++;
    } else {
      const leftover = evBeats - remaining;
      const leftoverDurs = decomposeDuration(leftover);
      sequence.content.splice(
        removeStart + removeCount,
        1,
        ...leftoverDurs.map((d) => {
          if (isRest(ev)) return createRest(d);
          return { ...ev, duration: d, id: generateEventId() } as NoteEvent;
        }),
      );
      remaining = 0;
      break;
    }
  }

  if (removeCount > 0) {
    sequence.content.splice(removeStart, removeCount);
  }
}

/**
 * Change the duration of an existing event. Handles three cases:
 *  - same duration → just normalize representation
 *  - shorter      → fill the freed beats with metric-aware rests
 *  - longer       → consume following content; if it overflows the
 *                   measure, split into tied fragments across barlines.
 */
// eslint-disable-next-line max-statements, complexity -- duration-change pipeline is an irreducible musical case analysis: same/shorter/longer branches each fan out into metric-aware rest fill, content consumption across following events, and barline-overflow tie-splitting. The state (remaining beats, current position, accumulated fragments) threads through every branch — splitting would force a large args bundle through helpers without sharing meaningful sub-concepts.
export function changeDuration(score: Score, params: ChangeDurationParams): Score {
  const { measureIndex, partIndex, voice, eventIndex, newDuration } = params;

  const part = score.parts[partIndex];
  if (!part) throw new Error(`Part ${partIndex} not found`);

  const partMeasure = part.measures[measureIndex];
  if (!partMeasure) throw new Error(`Measure ${measureIndex} not found`);

  const sequence = partMeasure.sequences[voice];
  if (!sequence) throw new Error(`Voice ${voice} not found`);

  const event = sequence.content[eventIndex] as NoteEvent | undefined;
  if (!event) throw new Error(`Event ${eventIndex} not found`);

  const oldBeats = durationToBeats(event.duration);
  const newBeats = durationToBeats(newDuration);
  const diff = newBeats - oldBeats;

  if (Math.abs(diff) < 1e-9) {
    event.duration = { ...newDuration };
    return score;
  }

  if (diff < 0) {
    event.duration = { ...newDuration };
    const gapBeats = -diff;
    let beatPos = 0;
    for (let i = 0; i < eventIndex; i++) {
      beatPos += sequenceContentBeats(sequence.content[i]!);
    }
    const ts = getEffectiveTimeSignature(score, measureIndex);
    const gapRests = decomposeRestsAtPosition(gapBeats, beatPos + newBeats, ts);
    const restEvents = gapRests.map((d) => createRest(d));
    sequence.content.splice(eventIndex + 1, 0, ...restEvents);
    mergeAdjacentRests(sequence, eventIndex, ts);
    return score;
  }

  // ─── Longer: consume following content and possibly tie across barlines ───
  let beatPosition = 0;
  for (let i = 0; i < eventIndex; i++) {
    beatPosition += sequenceContentBeats(sequence.content[i]!);
  }

  const timeSig = getEffectiveTimeSignature(score, measureIndex);
  const totalMeasureBeats = measureBeats(timeSig);
  const remainingInMeasure = totalMeasureBeats - beatPosition;

  const beatsInThisMeasure = Math.min(newBeats, remainingInMeasure);
  const firstFragBeats = beatsInThisMeasure;

  let consumed = oldBeats;
  let removeCount = 0;
  let idx = eventIndex + 1;
  while (consumed < firstFragBeats - 1e-9 && idx < sequence.content.length) {
    const next = sequence.content[idx]! as NoteEvent;
    const nextBeats = durationToBeats(next.duration);
    consumed += nextBeats;
    removeCount++;
    idx++;
  }

  if (removeCount > 0) {
    sequence.content.splice(eventIndex + 1, removeCount);
  }

  if (newBeats <= remainingInMeasure + 1e-9) {
    event.duration = { ...newDuration };
    const leftover = consumed - newBeats;
    if (leftover > 1e-9) {
      const ts = getEffectiveTimeSignature(score, measureIndex);
      const restStart = beatPosition + newBeats;
      const leftoverRests = decomposeRestsAtPosition(leftover, restStart, ts);
      sequence.content.splice(eventIndex + 1, 0, ...leftoverRests.map((d) => createRest(d)));
    }
    mergeAdjacentRests(sequence, eventIndex, getEffectiveTimeSignature(score, measureIndex));
    return score;
  }

  // ─── Overflow: split across barlines with ties ───
  const firstDurs = decomposeDuration(firstFragBeats);
  if (firstDurs.length > 0) {
    event.duration = firstDurs[0]!;
  }
  const isNote = !isRest(event) && event.notes && event.notes.length > 0;
  const pitch = isNote ? event.notes![0]!.pitch : null;

  const firstNoteId = generateNoteId();
  if (isNote && event.notes![0]) {
    event.notes![0]!.id = firstNoteId;
  }

  let prevNoteId = firstNoteId;
  for (let fi = 1; fi < firstDurs.length; fi++) {
    const fragDur = firstDurs[fi]!;
    const fragId = generateNoteId();
    const fragEvent: NoteEvent =
      isNote && pitch
        ? {
            type: "event",
            id: generateEventId(),
            duration: fragDur,
            notes: [{ id: fragId, pitch: { ...pitch } }],
          }
        : createRest(fragDur);

    if (isNote && event.notes) {
      const prevNote = findNoteById(score, partIndex, measureIndex, voice, prevNoteId);
      if (prevNote) {
        prevNote.ties = [{ target: fragId }];
      }
    }

    sequence.content.splice(eventIndex + 1 + (fi - 1), 0, fragEvent);
    prevNoteId = fragId;
  }

  const leftoverInMeasure = consumed - firstFragBeats;
  if (leftoverInMeasure > 1e-9) {
    const tsForMeasure = getEffectiveTimeSignature(score, measureIndex);
    const restStart = beatPosition + firstFragBeats;
    const leftoverRests = decomposeRestsAtPosition(leftoverInMeasure, restStart, tsForMeasure);
    const insertIdx = eventIndex + firstDurs.length;
    sequence.content.splice(insertIdx, 0, ...leftoverRests.map((d) => createRest(d)));
  }

  let overflow = newBeats - firstFragBeats;
  let mIdx = measureIndex + 1;

  while (overflow > 1e-9 && isNote && pitch) {
    while (mIdx >= score.global.measures.length) {
      score = appendMeasure(score);
    }

    const nextTS = getEffectiveTimeSignature(score, mIdx);
    const nextMB = measureBeats(nextTS);
    const fragBeats = Math.min(overflow, nextMB);

    ensureMeasureContent(score, mIdx, partIndex, voice);

    const fragDurs = decomposeDuration(fragBeats);
    let fragBeatPos = 0;

    for (const fragDur of fragDurs) {
      const fragNoteId = generateNoteId();
      const targetSeq = score.parts[partIndex]!.measures[mIdx]!.sequences[voice]!;
      consumeBeatsAt(targetSeq, fragBeatPos, durationToBeats(fragDur));

      const fragEvent: NoteEvent = {
        type: "event",
        id: generateEventId(),
        duration: fragDur,
        notes: [{ id: fragNoteId, pitch: { ...pitch } }],
      };

      let insertIdx = 0;
      let bp = 0;
      for (let si = 0; si < targetSeq.content.length; si++) {
        if (bp >= fragBeatPos - 1e-9) {
          insertIdx = si;
          break;
        }
        bp += sequenceContentBeats(targetSeq.content[si]!);
        insertIdx = si + 1;
      }

      targetSeq.content.splice(insertIdx, 0, fragEvent);

      const prevNote = findNoteById(
        score,
        partIndex,
        fragBeatPos === 0 && fragDurs.indexOf(fragDur) === 0 ? mIdx - 1 : mIdx,
        voice,
        prevNoteId,
      );
      if (prevNote) {
        prevNote.ties = [{ target: fragNoteId }];
      }

      prevNoteId = fragNoteId;
      fragBeatPos += durationToBeats(fragDur);
    }

    overflow -= fragBeats;
    mIdx++;
  }

  return score;
}

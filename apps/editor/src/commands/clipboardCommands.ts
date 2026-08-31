import type {
  SequenceContent,
  TimeSignature,
  KeySignature,
  Score,
  Duration,
  NoteEvent,
  Clef,
  Transposition,
  DynamicGroup,
} from "@viritura/core";
import { generateId, isRest, measureBeats } from "@viritura/core";
import { serializeFragment } from "../clipboard/serialize";
import { deserializeFragment, assignFreshIds } from "../clipboard/deserialize";
import type { ClipboardTrack, CapturedDynamic } from "../clipboard/ClipboardFragment";
import type { ClipboardFragment } from "../clipboard/ClipboardFragment";
import type { AnnotationLocation } from "../score/ElementPath";
import { deleteAnnotations } from "./deleteCommands";
import { sequenceContentBeats, decomposeDuration, generateEventId } from "./noteCommands";

/**
 * Selection info needed for clipboard operations.
 * This interface bridges the selection system with clipboard commands.
 */
export interface ClipboardSelection {
  /** Selected events to copy (primary track, for single-part selections) */
  events: SequenceContent[];
  /** Active time signature at the selection */
  timeSignature: TimeSignature;
  /** Active key signature at the selection */
  keySignature: KeySignature;
  /** Active clef at the source location (primary track). Used by preview. */
  clef?: Clef;
  /** Source-part transposition (primary track). Used by preview to display written pitches. */
  transposition?: Transposition;
  /** Multi-track content for cross-staff copy (one entry per part+voice) */
  tracks?: ClipboardTrack[];
  /** Dynamics in the primary track's spanned measures, filtered to selection */
  dynamics?: CapturedDynamic[];
  /** Location info for paste/cut */
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  /** Exact source-model events to replace when cutting multi-track/range content. */
  cutLocations?: ClipboardCutLocation[];
  cutAnnotationLocations?: AnnotationLocation[];
}

interface ClipboardCutLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
}

/**
 * Copy selected events to the system clipboard.
 * Serializes the selection as a Viritura MNX fragment JSON string.
 */
export async function copyToClipboard(selection: ClipboardSelection): Promise<boolean> {
  if (selection.events.length === 0) return false;

  const json = serializeFragment(
    selection.events,
    selection.timeSignature,
    selection.keySignature,
    selection.tracks,
    selection.clef,
    selection.transposition,
    selection.dynamics,
  );

  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cut selected events: copy to clipboard and return events replaced with rests.
 * The caller is responsible for applying the returned score mutation.
 */
export async function cutToClipboard(selection: ClipboardSelection): Promise<CutResult | null> {
  // System clipboard is best-effort. The editor's internal clipboard history
  // still receives the fragment, so a denied browser clipboard must not turn
  // Cut into a no-op.
  await copyToClipboard(selection);

  // Build rest replacements for each cut event
  const replacements: SequenceContent[] = selection.events.map((event) => ({
    type: "event" as const,
    duration: { ...(event as NoteEvent).duration },
    rest: {},
  }));

  return {
    partIndex: selection.partIndex,
    measureIndex: selection.measureIndex,
    sequenceIndex: selection.sequenceIndex,
    eventIndex: selection.eventIndex,
    replacements,
    cutLocations: selection.cutLocations,
    cutAnnotationLocations: selection.cutAnnotationLocations,
  };
}

/** Result of a cut operation — tells the caller what to replace in the score */
export interface CutResult {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  replacements: SequenceContent[];
  cutLocations?: ClipboardCutLocation[];
  cutAnnotationLocations?: AnnotationLocation[];
}

/**
 * Read from the system clipboard and parse as a Viritura fragment.
 * Returns the deserialized content with fresh IDs, or null if invalid.
 */
export async function pasteFromClipboard(): Promise<PasteResult | null> {
  try {
    const text = await navigator.clipboard.readText();
    const fragment = deserializeFragment(text);
    if (!fragment) return null;

    return pasteResultFromFragment(fragment);
  } catch {
    return null;
  }
}

export function pasteResultFromFragment(fragment: ClipboardFragment): PasteResult {
  return {
    content: assignFreshIds(fragment.content),
    sourceTimeSignature: fragment.timeSignature,
    sourceKeySignature: fragment.keySignature,
    dynamics: fragment.dynamics,
    tracks: fragment.tracks?.map((track) => ({
      ...track,
      content: assignFreshIds(track.content),
    })),
  };
}

/** Result of a paste operation — content to insert at the cursor position */
export interface PasteResult {
  /** Events to insert, with fresh IDs assigned (primary track) */
  content: SequenceContent[];
  /** Time signature from the source context */
  sourceTimeSignature: TimeSignature;
  /** Key signature from the source context */
  sourceKeySignature: KeySignature;
  /** Dynamics captured at copy time, to be replayed at the paste site */
  dynamics?: CapturedDynamic[];
  /** Multi-track content for cross-staff paste */
  tracks?: ClipboardTrack[];
}

/**
 * Apply a paste operation to a Score model.
 *
 * For single-track (traditional) paste: replaces events by duration at the
 * given position, distributing across measures.
 *
 * For multi-track paste (cross-staff copy): applies each track to its
 * corresponding part (relative to the paste position), handling grand staff
 * instruments (multiple voices/sequences per part).
 *
 * Returns a new Score (immutable update).
 */
export function applyPaste(
  score: Score,
  paste: PasteResult,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
): Score {
  const part = score.parts[partIndex];
  if (!part) return score;
  const measure = part.measures[measureIndex];
  if (!measure) return score;
  const sequence = measure.sequences[sequenceIndex];
  if (!sequence) return score;

  // Deep clone to avoid mutation
  const newScore = structuredClone(score);

  // Compute paste start beat (quarter-note beats from measure start, primary staff)
  // — needed for both event placement and dynamic-position remapping.
  const primarySeqForBeat = newScore.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  let pasteStartBeat = 0;
  if (primarySeqForBeat) {
    for (let i = 0; i < eventIndex && i < primarySeqForBeat.content.length; i++) {
      pasteStartBeat += sequenceContentBeats(primarySeqForBeat.content[i]!);
    }
  }

  // Multi-track paste: apply each track at its relative part offset
  if (paste.tracks && paste.tracks.length > 0) {
    for (const track of paste.tracks) {
      const targetPartIdx = partIndex + track.partOffset;
      const targetVoice = track.voiceIndex;

      if (targetPartIdx < 0 || targetPartIdx >= newScore.parts.length) continue;
      const targetPart = newScore.parts[targetPartIdx]!;
      const targetMeasure = targetPart.measures[measureIndex];
      if (!targetMeasure) continue;

      // Ensure the sequence exists
      while (targetMeasure.sequences.length <= targetVoice) {
        targetMeasure.sequences.push({ content: [] });
      }

      // Find the event index on the target staff that corresponds to the
      // same beat position as the primary track's paste point.
      // This maintains vertical alignment across staves.
      let targetEventIdx: number;
      if (track.partOffset === 0 && targetVoice === sequenceIndex) {
        targetEventIdx = eventIndex;
      } else {
        const targetSeq = targetMeasure.sequences[targetVoice]!;
        targetEventIdx = 0;
        let beatPos = 0;
        for (let i = 0; i < targetSeq.content.length; i++) {
          if (beatPos >= pasteStartBeat - 1e-9) break;
          beatPos += sequenceContentBeats(targetSeq.content[i]!);
          targetEventIdx = i + 1;
        }
      }

      pasteTrackIntoScore(newScore, targetPartIdx, measureIndex, targetVoice, targetEventIdx, track.content);

      if (track.dynamics && track.dynamics.length > 0) {
        applyCapturedDynamics(newScore, targetPartIdx, measureIndex, pasteStartBeat, track.dynamics);
      }
    }
    return newScore;
  }

  // Single-track paste (backward compatible)
  pasteTrackIntoScore(newScore, partIndex, measureIndex, sequenceIndex, eventIndex, paste.content);

  if (paste.dynamics && paste.dynamics.length > 0) {
    applyCapturedDynamics(newScore, partIndex, measureIndex, pasteStartBeat, paste.dynamics);
  }
  return newScore;
}

/**
 * Replay captured dynamics into the target part's measures.
 *
 * Each `CapturedDynamic` carries:
 *  - `measureOffset`: offset from the selection's first measure.
 *  - `position`: for `measureOffset === 0`, the position is stored
 *    *relative to the selection window start* (i.e. already shifted so beat 0
 *    means "start of selection"). For later measures, the position is the
 *    original measure-relative position.
 *
 * Paste behavior:
 *  - First-measure dynamics: new beat = `pasteStartBeat + capturedBeat`.
 *  - Later measures: position is preserved (selection always begins at beat 0
 *    of any subsequent measure).
 *  - Dynamics that end up beyond a measure's capacity are dropped.
 */
function applyCapturedDynamics(
  score: Score,
  partIndex: number,
  measureIndex: number,
  pasteStartBeat: number,
  captured: CapturedDynamic[],
): void {
  const part = score.parts[partIndex];
  if (!part) return;

  function getTimeSigAt(mIdx: number): TimeSignature {
    let ts: TimeSignature = { count: 4, unit: 4 };
    for (let i = 0; i <= mIdx && i < score.global.measures.length; i++) {
      const gm = score.global.measures[i];
      if (gm?.time) ts = gm.time;
    }
    return ts;
  }

  function fractionToQuarterBeats(frac: [number, number]): number {
    if (!frac || frac[1] === 0) return 0;
    return (frac[0] / frac[1]) * 4;
  }

  function quarterBeatsToFraction(beats: number): [number, number] {
    const denom = 16;
    const num = Math.round((beats / 4) * denom);
    return [num, denom];
  }

  for (const c of captured) {
    const targetMeasureIdx = measureIndex + c.measureOffset;
    if (targetMeasureIdx < 0 || targetMeasureIdx >= part.measures.length) continue;
    const targetMeasure = part.measures[targetMeasureIdx]!;

    const srcBeats = fractionToQuarterBeats(c.dynamic.position.fraction);
    const newBeats = c.measureOffset === 0 ? pasteStartBeat + srcBeats : srcBeats;

    const cap = measureBeats(getTimeSigAt(targetMeasureIdx));
    if (newBeats < -1e-9 || newBeats >= cap - 1e-9) continue;

    const newDyn: DynamicGroup = {
      ...structuredClone(c.dynamic),
      id: generateId(),
      position: { fraction: quarterBeatsToFraction(Math.max(0, newBeats)) },
    };

    if (newDyn.type === "gradual") {
      if (c.endMeasureOffset === undefined) continue;
      const endMeasureIndex = measureIndex + c.endMeasureOffset;
      const endMeasure = score.global.measures[endMeasureIndex];
      if (!endMeasure?.id || endMeasureIndex < 0 || endMeasureIndex >= part.measures.length) continue;
      const sourceEndBeats = fractionToQuarterBeats(newDyn.end.position.fraction);
      const endBeats = c.endMeasureOffset === 0 ? pasteStartBeat + sourceEndBeats : sourceEndBeats;
      const endCapacity = measureBeats(getTimeSigAt(endMeasureIndex));
      if (endBeats < -1e-9 || endBeats > endCapacity + 1e-9) continue;
      newDyn.end = {
        measure: endMeasure.id,
        position: { fraction: quarterBeatsToFraction(Math.max(0, endBeats)) },
      };
    }

    if (!targetMeasure.dynamics) targetMeasure.dynamics = [];
    targetMeasure.dynamics.push(newDyn);
  }
}

/**
 * Paste a single track of content into a score at the specified location.
 * Handles duration-aware replacement and cross-measure distribution.
 */
function pasteTrackIntoScore(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
  content: SequenceContent[],
): void {
  const part = score.parts[partIndex];
  if (!part) return;

  function getTimeSigAt(mIdx: number): TimeSignature {
    let ts: TimeSignature = { count: 4, unit: 4 };
    for (let i = 0; i <= mIdx && i < score.global.measures.length; i++) {
      const gm = score.global.measures[i];
      if (gm?.time) ts = gm.time;
    }
    return ts;
  }

  // Ensure starting sequence exists
  const startMeasure = part.measures[measureIndex];
  if (!startMeasure) return;
  while (startMeasure.sequences.length <= sequenceIndex) {
    startMeasure.sequences.push({ content: [] });
  }

  const startSeq = startMeasure.sequences[sequenceIndex]!;
  let pasteStartBeat = 0;
  for (let i = 0; i < eventIndex && i < startSeq.content.length; i++) {
    pasteStartBeat += sequenceContentBeats(startSeq.content[i]!);
  }

  const pasteBeats = content.reduce((sum, ev) => sum + sequenceContentBeats(ev), 0);
  // Grace-only content has 0 beats but should still be inserted (the grace
  // notes display before whatever note is at the cursor position).
  if (pasteBeats <= 0 && content.length === 0) return;
  if (pasteBeats <= 0) {
    insertGraceOnly(startSeq, content, pasteStartBeat);
    return;
  }

  clearTargetRegion(part, sequenceIndex, measureIndex, eventIndex, pasteBeats, pasteStartBeat, getTimeSigAt);

  insertPasteContent(score, part, sequenceIndex, measureIndex, pasteStartBeat, content, getTimeSigAt);
}

/**
 * Pure grace-note paste: splice directly at the insert index, no clearing.
 */
function insertGraceOnly(
  startSeq: { content: SequenceContent[] },
  content: SequenceContent[],
  pasteStartBeat: number,
): void {
  let insertIdx = 0;
  let beatPos = 0;
  for (let i = 0; i < startSeq.content.length; i++) {
    if (beatPos >= pasteStartBeat - 1e-9) break;
    beatPos += sequenceContentBeats(startSeq.content[i]!);
    insertIdx = i + 1;
  }
  startSeq.content.splice(insertIdx, 0, ...content);
}

/**
 * Phase 1: clear the target region, respecting measure capacity.
 * Each measure can absorb up to `(measureBeats - startBeat)` of paste
 * content, so we only clear events within that capacity — never leaking
 * into unrelated measures.
 */
function clearTargetRegion(
  part: { measures: { sequences: { content: SequenceContent[]; fullMeasure?: unknown }[] }[] },
  sequenceIndex: number,
  measureIndex: number,
  eventIndex: number,
  pasteBeats: number,
  pasteStartBeat: number,
  getTimeSigAt: (mIdx: number) => TimeSignature,
): void {
  let remainingClearBeats = pasteBeats;
  let curMeasure = measureIndex;
  let curEventIdx = eventIndex;

  while (remainingClearBeats > 1e-9 && curMeasure < part.measures.length) {
    const measure = part.measures[curMeasure]!;
    while (measure.sequences.length <= sequenceIndex) {
      measure.sequences.push({ content: [] });
    }
    const seq = measure.sequences[sequenceIndex]!;

    if (seq.fullMeasure) delete seq.fullMeasure;

    const mBeats = measureBeats(getTimeSigAt(curMeasure));
    const startBeat = curMeasure === measureIndex ? pasteStartBeat : 0;
    const measureCapacity = mBeats - startBeat;
    const clearBudget = Math.min(remainingClearBeats, measureCapacity);

    clearEventsInMeasure(seq, curEventIdx, clearBudget);

    // Deduct the full measure capacity (not just cleared events) since
    // Phase 2 will fill this space. Handles underfull/fullMeasure measures.
    remainingClearBeats -= measureCapacity;

    if (remainingClearBeats > 1e-9) {
      curMeasure++;
      curEventIdx = 0;
    }
  }
}

function clearEventsInMeasure(seq: { content: SequenceContent[] }, startEventIdx: number, clearBudget: number): void {
  let clearedBeats = 0;
  const curEventIdx = startEventIdx;

  while (curEventIdx < seq.content.length && clearedBeats < clearBudget - 1e-9) {
    const ev = seq.content[curEventIdx]!;
    const evBeats = sequenceContentBeats(ev);

    if (evBeats <= clearBudget - clearedBeats + 1e-9) {
      seq.content.splice(curEventIdx, 1);
      clearedBeats += evBeats;
      continue;
    }
    // Partial: split into leftover rests
    const leftoverBeats = evBeats - (clearBudget - clearedBeats);
    const leftoverDurations = decomposeDuration(leftoverBeats);
    const leftoverRests: NoteEvent[] = leftoverDurations.map((d) => ({
      type: "event" as const,
      id: generateEventId(),
      duration: d,
      rest: {},
    }));
    seq.content.splice(curEventIdx, 1, ...leftoverRests);
    return;
  }
}

/**
 * Phase 2: insert content measure by measure.
 * Auto-appends measures if paste overflows past the end of the score.
 */
function insertPasteContent(
  score: Score,
  part: { measures: { sequences: { content: SequenceContent[]; fullMeasure?: unknown }[] }[] },
  sequenceIndex: number,
  startMeasureIndex: number,
  pasteStartBeat: number,
  content: SequenceContent[],
  getTimeSigAt: (mIdx: number) => TimeSignature,
): void {
  let insertMeasure = startMeasureIndex;
  let insertBeat = pasteStartBeat;
  let contentIdx = 0;

  while (contentIdx < content.length) {
    if (insertMeasure >= part.measures.length) {
      score.global.measures.push({});
      for (const p of score.parts) {
        p.measures.push({ sequences: [{ content: [] }] });
      }
    }

    const measure = part.measures[insertMeasure]!;
    while (measure.sequences.length <= sequenceIndex) {
      measure.sequences.push({ content: [] });
    }
    const seq = measure.sequences[sequenceIndex]!;

    if (seq.fullMeasure) delete seq.fullMeasure;

    const mBeats = measureBeats(getTimeSigAt(insertMeasure));
    const availableBeats = mBeats - insertBeat;

    const eventsForThisMeasure = takeEventsFitting(content, contentIdx, availableBeats);
    contentIdx += eventsForThisMeasure.length;

    spliceAtBeat(seq, insertBeat, eventsForThisMeasure);
    mergeRests(seq);

    insertMeasure++;
    insertBeat = 0;
  }
}

/** Take as many events from `content` starting at `startIdx` as fit in `availableBeats`. */
function takeEventsFitting(content: SequenceContent[], startIdx: number, availableBeats: number): SequenceContent[] {
  const taken: SequenceContent[] = [];
  let usedBeats = 0;
  let idx = startIdx;
  while (idx < content.length && usedBeats < availableBeats - 1e-9) {
    const ev = content[idx]!;
    const evBeats = sequenceContentBeats(ev);
    if (usedBeats + evBeats > availableBeats + 1e-9) break;
    taken.push(ev);
    usedBeats += evBeats;
    idx++;
  }
  return taken;
}

/** Splice `events` into the sequence at the given beat offset. */
function spliceAtBeat(seq: { content: SequenceContent[] }, insertBeat: number, events: SequenceContent[]): void {
  let insertIdx = 0;
  let beatPos = 0;
  for (let i = 0; i < seq.content.length; i++) {
    if (beatPos >= insertBeat - 1e-9) break;
    beatPos += sequenceContentBeats(seq.content[i]!);
    insertIdx = i + 1;
  }
  seq.content.splice(insertIdx, 0, ...events);
}

/** Merge adjacent rests in a sequence when they form a clean duration. */
function mergeRests(seq: { content: SequenceContent[] }): void {
  let i = 0;
  while (i < seq.content.length - 1) {
    const curr = seq.content[i]!;
    const next = seq.content[i + 1]!;
    if (isRest(curr as NoteEvent) && isRest(next as NoteEvent)) {
      const totalBeats = sequenceContentBeats(curr) + sequenceContentBeats(next);
      const merged = decomposeDuration(totalBeats);
      if (merged.length === 1) {
        const rest: NoteEvent = {
          type: "event",
          id: generateEventId(),
          duration: merged[0]! as Duration,
          rest: {},
        };
        seq.content.splice(i, 2, rest);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
}

/**
 * Apply a cut operation to a Score model.
 * Replaces cut events with rests of matching duration.
 *
 * Returns a new Score (immutable update).
 */
export function applyCut(score: Score, cut: CutResult): Score {
  if (cut.cutLocations && cut.cutLocations.length > 0) {
    const newScore = structuredClone(score);
    const ordered = [...cut.cutLocations].sort(
      (left, right) =>
        right.partIndex - left.partIndex ||
        right.measureIndex - left.measureIndex ||
        right.sequenceIndex - left.sequenceIndex ||
        (right.tupletIndex ?? -1) - (left.tupletIndex ?? -1) ||
        right.eventIndex - left.eventIndex,
    );
    for (const location of ordered) {
      const sequence =
        newScore.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
      if (!sequence) continue;
      const content =
        location.tupletIndex === undefined
          ? sequence.content
          : (() => {
              const container = sequence.content[location.tupletIndex!];
              return container?.type === "tuplet" || container?.type === "tremolo" ? container.content : undefined;
            })();
      const event = content?.[location.eventIndex];
      if (!event || event.type !== "event") continue;
      content![location.eventIndex] = { type: "event", duration: { ...event.duration }, rest: {} };
    }
    return deleteCutAnnotations(newScore, cut);
  }

  const part = score.parts[cut.partIndex];
  if (!part) return score;
  const measure = part.measures[cut.measureIndex];
  if (!measure) return score;
  const sequence = measure.sequences[cut.sequenceIndex];
  if (!sequence) return score;

  const newScore = structuredClone(score);
  const targetSeq = newScore.parts[cut.partIndex]!.measures[cut.measureIndex]!.sequences[cut.sequenceIndex]!;

  // Replace each cut event with its rest replacement
  for (let i = 0; i < cut.replacements.length; i++) {
    const idx = cut.eventIndex + i;
    if (idx < targetSeq.content.length) {
      targetSeq.content[idx] = cut.replacements[i]!;
    }
  }

  return deleteCutAnnotations(newScore, cut);
}

function deleteCutAnnotations(score: Score, cut: CutResult): Score {
  return cut.cutAnnotationLocations?.length ? (deleteAnnotations(score, cut.cutAnnotationLocations) ?? score) : score;
}

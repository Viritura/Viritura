import type {
  SequenceContent,
  TimeSignature,
  KeySignature,
  Score,
  NoteEvent,
  Clef,
  Transposition,
  DynamicGroup,
  GlobalLyrics,
  ChordSymbol,
  Space,
} from "@viritura/core";
import { generateId, measureBeats } from "@viritura/core";
import { deserializeFragment, assignFreshTrackIds } from "../clipboard/deserialize";
import { looksLikeMuseScoreXml, readMuseScoreClipboard } from "@viritura/musescore-clipboard";
import {
  NotationClipboardError,
  pasteResultFromMuseScore,
  readNotationClipboard,
  writeClipboardFragment,
} from "../clipboard/notationClipboard";
import type {
  CapturedMeasureRepeat,
  ClipboardTrack,
  CapturedDynamic,
  CapturedChordSymbol,
} from "../clipboard/ClipboardFragment";
import type { ClipboardFragment } from "../clipboard/ClipboardFragment";
import type { AnnotationLocation } from "../score/ElementPath";
import { deleteAnnotations } from "./deleteCommands";
import { sequenceContentBeats } from "./noteCommands";
import {
  addWholeFractions,
  compareWholeFractions,
  contentWholeFraction,
  ensureSequencePosition,
  exactWholeFraction,
  sequenceBoundaryFraction,
  splitSequenceAtBeat,
  subtractWholeFractions,
} from "../clipboard/clipboardTrackPlacement";
import { ensurePasteMeasure, pasteTrackIntoScore, sequenceForStaffVoice } from "../clipboard/pasteContent";
import {
  capturedAnnotationDestination,
  resolvePhysicalStaffDestination,
  unassignedDynamics,
  type CaptureOrigin,
} from "../clipboard/annotations";

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
  chordSymbols?: CapturedChordSymbol[];
  measureRepeats?: CapturedMeasureRepeat[];
  /** Metadata and ordering for lyric lines referenced by copied events. */
  lyrics?: GlobalLyrics;
  /** Location info for paste/cut */
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  /** Rhythmic origin shared by captured tracks, including synthesized measure rests. */
  captureOrigin?: CaptureOrigin;
  /** Exact source-model events to replace when cutting multi-track/range content. */
  cutLocations?: ClipboardCutLocation[];
  cutAnnotationLocations?: AnnotationLocation[];
  cutMeasureRepeats?: Array<{ partIndex: number; measureIndex: number }>;
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
 * Preserves Viritura JSON alongside MuseScore notation on native clipboards.
 */
export async function copyToClipboard(
  selection: ClipboardSelection,
  onConversionWarning?: (message: string) => void,
): Promise<boolean> {
  if (
    selection.events.length === 0 &&
    !selection.measureRepeats?.length &&
    !selection.dynamics?.length &&
    !selection.chordSymbols?.length
  )
    return false;

  try {
    await writeClipboardFragment(
      {
        content: selection.events,
        timeSignature: selection.timeSignature,
        keySignature: selection.keySignature,
        tracks: selection.tracks,
        clef: selection.clef,
        transposition: selection.transposition,
        dynamics: selection.dynamics,
        measureRepeats: selection.measureRepeats,
        lyrics: selection.lyrics,
        chordSymbols: selection.chordSymbols,
      },
      onConversionWarning,
    );
    return true;
  } catch (error) {
    if (error instanceof NotationClipboardError && error.backend === "native") throw error;
    return false;
  }
}

/**
 * Cut selected events: copy to clipboard and return events replaced with rests.
 * The caller is responsible for applying the returned score mutation.
 */
export async function cutToClipboard(
  selection: ClipboardSelection,
  onConversionWarning?: (message: string) => void,
): Promise<CutResult | null> {
  // System clipboard is best-effort. The editor's internal clipboard history
  // still receives the fragment, so a denied browser clipboard must not turn
  // Cut into a no-op.
  try {
    await copyToClipboard(selection, onConversionWarning);
  } catch (error) {
    onConversionWarning?.(error instanceof Error ? error.message : "Could not copy to the system clipboard.");
  }

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
    cutMeasureRepeats: selection.cutMeasureRepeats,
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
  cutMeasureRepeats?: Array<{ partIndex: number; measureIndex: number }>;
}

/**
 * Prefer Viritura JSON, then recognized MuseScore notation, assigning fresh IDs.
 * Only unrelated text or unavailable reads permit clipboard-history fallback.
 */
export async function pasteFromClipboard(onReadWarning?: (message: string) => void): Promise<PasteResult | null> {
  let clipboard;
  try {
    clipboard = await readNotationClipboard();
  } catch (error) {
    if (error instanceof NotationClipboardError && error.canUseHistory) {
      onReadWarning?.(error.message);
      return null;
    }
    throw error;
  }
  const fragment = deserializeFragment(clipboard.text);
  if (fragment) return pasteResultFromFragment(fragment);
  if (clipboard.museScore) {
    return pasteResultFromMuseScore(readMuseScoreClipboard(clipboard.museScore.xml, clipboard.museScore.mime));
  }
  if (looksLikeMuseScoreXml(clipboard.text)) {
    return pasteResultFromMuseScore(readMuseScoreClipboard(clipboard.text));
  }
  return null;
}

export function pasteResultFromFragment(fragment: ClipboardFragment): PasteResult {
  return {
    ...assignFreshTrackIds(fragment.content, fragment.tracks),
    sourceTimeSignature: fragment.timeSignature,
    sourceKeySignature: fragment.keySignature,
    transposition: fragment.transposition ? structuredClone(fragment.transposition) : undefined,
    dynamics: fragment.dynamics,
    chordSymbols: fragment.chordSymbols,
    measureRepeats: fragment.measureRepeats,
    lyrics: fragment.lyrics ? structuredClone(fragment.lyrics) : undefined,
  };
}

/** Result of a paste operation — content to insert at the cursor position */
export interface PasteResult {
  /** Events to insert, with fresh IDs assigned (primary track) */
  content: SequenceContent[];
  /** Time signature from the source context */
  sourceTimeSignature?: TimeSignature;
  /** Key signature from the source context */
  sourceKeySignature?: KeySignature;
  /** Source metadata; imported note pitches are already sounding pitches. */
  transposition?: Transposition;
  /** Dynamics captured at copy time, to be replayed at the paste site */
  dynamics?: CapturedDynamic[];
  chordSymbols?: CapturedChordSymbol[];
  /** Multi-track content for cross-staff paste */
  tracks?: ClipboardTrack[];
  measureRepeats?: CapturedMeasureRepeat[];
  lyrics?: GlobalLyrics;
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
  placedContent?: SequenceContent[],
  /** Rhythmic origin for physical tracks, before their individual lead-ins. */
  physicalTrackStartBeat?: number,
): Score {
  const part = score.parts[partIndex];
  if (!part) return score;
  const measure = part.measures[measureIndex];
  if (!measure) return score;
  const sequence = measure.sequences[sequenceIndex];
  if (!sequence) return score;

  // Deep clone to avoid mutation
  const newScore = structuredClone(score);
  mergeClipboardLyrics(newScore, paste.lyrics);

  // Share the exact source boundary: other voices cannot recover its floating-point summation error.
  // Numeric beats remain available for legacy placement and dynamic-position remapping.
  const pasteStartFraction =
    physicalTrackStartBeat === undefined
      ? sequence.content
          .slice(0, Math.max(0, eventIndex))
          .reduce<Space["duration"]>((sum, item) => addWholeFractions(sum, contentWholeFraction(item)), [0, 1])
      : (sequenceBoundaryFraction(sequence.content, physicalTrackStartBeat) ??
        exactWholeFraction(physicalTrackStartBeat));
  const pasteStartBeat = (pasteStartFraction[0] / pasteStartFraction[1]) * 4;
  applyCapturedMeasureRepeats(newScore, paste.measureRepeats, partIndex, measureIndex);

  // Multi-track paste: apply each track at its relative part offset
  if (paste.tracks && paste.tracks.length > 0) {
    applyClipboardTracks(newScore, paste.tracks, partIndex, measureIndex, sequenceIndex, eventIndex, pasteStartBeat);
    applyCapturedDynamicsByPart(
      newScore,
      partIndex,
      measureIndex,
      pasteStartBeat,
      unassignedDynamics(paste.dynamics, paste.tracks),
      paste.tracks,
      (sequence.staff ?? 1) - 1,
    );
    applyCapturedChordSymbols(
      newScore,
      partIndex,
      measureIndex,
      pasteStartFraction,
      paste.chordSymbols,
      paste.tracks,
      (sequence.staff ?? 1) - 1,
    );
    return newScore;
  }

  function applyClipboardTracks(
    score: Score,
    tracks: ClipboardTrack[],
    partIndex: number,
    measureIndex: number,
    sequenceIndex: number,
    eventIndex: number,
    pasteStartBeat: number,
  ): void {
    for (const track of tracks) {
      if (track.staffOffset !== undefined) {
        applyPhysicalClipboardTrack(score, track, partIndex, measureIndex, sequenceIndex, pasteStartBeat);
      } else {
        applyLegacyClipboardTrack(score, track, partIndex, measureIndex, sequenceIndex, eventIndex, pasteStartBeat);
      }
    }
  }

  function applyPhysicalClipboardTrack(
    score: Score,
    track: ClipboardTrack,
    partIndex: number,
    measureIndex: number,
    sequenceIndex: number,
    pasteStartBeat: number,
  ): void {
    const anchorStaff = (score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex]?.staff ?? 1) - 1;
    const destination = resolvePhysicalStaffDestination(score, partIndex, anchorStaff, track.staffOffset ?? 0);
    if (track.content.length > 0) {
      const targetPosition = resolveExactOffsetPosition(score, measureIndex, pasteStartFraction, track.leadIn);
      ensurePasteMeasure(score, targetPosition.measureIndex);
      const targetMeasure = score.parts[destination.partIndex]?.measures[targetPosition.measureIndex];
      if (!targetMeasure) throw new Error("Clipboard staff has no destination measure.");
      const targetSequence = sequenceForStaffVoice(
        targetMeasure.sequences,
        destination.staffIndex + 1,
        track.voiceIndex,
      );
      ensureSequencePosition(targetSequence.content, targetPosition.beat, targetPosition.fraction);
      splitSequenceAtBeat(targetSequence.content, targetPosition.beat, targetPosition.fraction);
      const inserted = pasteTrackIntoScore(
        score,
        destination.partIndex,
        targetPosition.measureIndex,
        targetMeasure.sequences.indexOf(targetSequence),
        eventIndexAtBeat(targetSequence.content, targetPosition.beat, targetPosition.fraction),
        track.content,
      );
      placedContent?.push(...inserted);
    }
    if (track.dynamics?.length) {
      applyCapturedDynamics(
        score,
        destination.partIndex,
        measureIndex,
        pasteStartBeat,
        track.dynamics.map((captured) => ({
          ...captured,
          dynamic: { ...captured.dynamic, staff: destination.staffIndex + 1 },
        })),
      );
    }
  }

  function applyLegacyClipboardTrack(
    score: Score,
    track: ClipboardTrack,
    partIndex: number,
    measureIndex: number,
    sequenceIndex: number,
    eventIndex: number,
    pasteStartBeat: number,
  ): void {
    const targetPartIndex = partIndex + track.partOffset;
    const targetPart = score.parts[targetPartIndex];
    const targetMeasure = targetPart?.measures[measureIndex];
    if (!targetPart || !targetMeasure) return;
    if (track.content.length > 0) {
      while (targetMeasure.sequences.length <= track.voiceIndex) targetMeasure.sequences.push({ content: [] });
      const targetSequence = targetMeasure.sequences[track.voiceIndex]!;
      const targetEventIndex =
        track.partOffset === 0 && track.voiceIndex === sequenceIndex
          ? eventIndex
          : eventIndexAtBeat(targetSequence.content, pasteStartBeat);
      const inserted = pasteTrackIntoScore(
        score,
        targetPartIndex,
        measureIndex,
        track.voiceIndex,
        targetEventIndex,
        track.content,
      );
      placedContent?.push(...inserted);
    }
    if (track.dynamics?.length) {
      applyCapturedDynamics(score, targetPartIndex, measureIndex, pasteStartBeat, track.dynamics);
    }
  }

  // Single-track paste (backward compatible)
  const inserted = pasteTrackIntoScore(newScore, partIndex, measureIndex, sequenceIndex, eventIndex, paste.content);
  placedContent?.push(...inserted);

  if (paste.dynamics && paste.dynamics.length > 0) {
    applyCapturedDynamicsByPart(
      newScore,
      partIndex,
      measureIndex,
      pasteStartBeat,
      paste.dynamics,
      undefined,
      (sequence.staff ?? 1) - 1,
    );
  }
  applyCapturedChordSymbols(
    newScore,
    partIndex,
    measureIndex,
    pasteStartFraction,
    paste.chordSymbols,
    undefined,
    (sequence.staff ?? 1) - 1,
  );
  return newScore;
}

function eventIndexAtBeat(
  content: readonly SequenceContent[],
  targetBeat: number,
  targetFraction?: Space["duration"],
): number {
  if (targetFraction) {
    let onset: Space["duration"] = [0, 1];
    for (let index = 0; index < content.length; index++) {
      if (compareWholeFractions(onset, targetFraction) >= 0) return index;
      onset = addWholeFractions(onset, contentWholeFraction(content[index]!));
    }
    return content.length;
  }
  let beat = 0;
  for (let index = 0; index < content.length; index++) {
    if (beat >= targetBeat - 1e-9) return index;
    beat += sequenceContentBeats(content[index]!);
  }
  return content.length;
}

function resolveExactOffsetPosition(
  score: Score,
  measureIndex: number,
  start: Space["duration"],
  offset: Space["duration"] | undefined,
): { measureIndex: number; beat: number; fraction: Space["duration"] } {
  let fraction = addWholeFractions(start, offset ?? [0, 1]);
  while (true) {
    const time = activeTimeSignature(score, measureIndex);
    const capacity: Space["duration"] = [time.count, time.unit];
    if (compareWholeFractions(capacity, [0, 1]) <= 0) throw new Error("Invalid destination measure duration.");
    if (compareWholeFractions(fraction, capacity) < 0) {
      return { measureIndex, beat: (fraction[0] / fraction[1]) * 4, fraction };
    }
    fraction = subtractWholeFractions(fraction, capacity);
    measureIndex++;
  }
}

function resolveOffsetPosition(
  score: Score,
  measureIndex: number,
  startBeat: number,
  offset: readonly [number, number] | undefined,
  allowMeasureEnd = false,
): { measureIndex: number; beat: number } {
  let targetMeasure = measureIndex;
  let beat = startBeat + (offset ? (offset[0] / offset[1]) * 4 : 0);
  if (!Number.isFinite(beat) || beat < 0) throw new Error("Invalid clipboard timing offset.");
  while (true) {
    const capacity = measureBeats(activeTimeSignature(score, targetMeasure));
    if (!Number.isFinite(capacity) || capacity <= 1e-9) throw new Error("Invalid destination measure duration.");
    if (beat < capacity - 1e-9 || (allowMeasureEnd && Math.abs(beat - capacity) < 1e-9)) {
      return { measureIndex: targetMeasure, beat };
    }
    const nextBeat = Math.max(0, beat - capacity);
    if (nextBeat >= beat) throw new Error("Clipboard offset made no rhythmic progress.");
    beat = nextBeat;
    targetMeasure++;
  }
}

function activeTimeSignature(score: Score, measureIndex: number): TimeSignature {
  let time: TimeSignature = { count: 4, unit: 4 };
  for (let index = 0; index <= measureIndex && index < score.global.measures.length; index++) {
    if (score.global.measures[index]?.time) time = score.global.measures[index]!.time!;
  }
  return time;
}

function applyCapturedChordSymbols(
  score: Score,
  partIndex: number,
  measureIndex: number,
  pasteStartFraction: Space["duration"],
  captured: CapturedChordSymbol[] | undefined,
  tracks?: ClipboardTrack[],
  anchorStaffIndex = 0,
): void {
  for (const item of captured ?? []) {
    const destination = capturedAnnotationDestination(
      score,
      partIndex,
      anchorStaffIndex,
      tracks,
      item.partOffset ?? 0,
      item.chordSymbol.displayStaff ?? 1,
      item.staffOffset,
    );
    const position = item.offset
      ? resolveExactOffsetPosition(score, measureIndex, pasteStartFraction, item.offset)
      : {
          measureIndex: measureIndex + item.measureOffset,
          fraction: addWholeFractions(
            item.measureOffset === 0 ? pasteStartFraction : [0, 1],
            item.chordSymbol.position.fraction,
          ),
        };
    const measure = score.parts[destination.partIndex]?.measures[position.measureIndex];
    if (!measure) continue;
    const chordSymbol: ChordSymbol = {
      ...structuredClone(item.chordSymbol),
      ...(destination.staff === undefined ? {} : { displayStaff: destination.staff }),
      position: { fraction: position.fraction },
    };
    measure.chordSymbols ??= [];
    measure.chordSymbols = measure.chordSymbols.filter(
      (existing) =>
        (existing.displayStaff ?? 1) !== (chordSymbol.displayStaff ?? 1) ||
        existing.position.fraction[0] / existing.position.fraction[1] !==
          chordSymbol.position.fraction[0] / chordSymbol.position.fraction[1],
    );
    measure.chordSymbols.push(chordSymbol);
  }
}

function mergeClipboardLyrics(score: Score, lyrics: GlobalLyrics | undefined): void {
  if (!lyrics) return;
  score.global.lyrics ??= {};
  const target = score.global.lyrics;
  if (lyrics.lineMetadata) {
    target.lineMetadata ??= {};
    for (const [lineId, metadata] of Object.entries(lyrics.lineMetadata)) {
      target.lineMetadata[lineId] ??= structuredClone(metadata);
    }
  }
  const existingOrder = target.lineOrder ?? [];
  const sourceOrder = lyrics.lineOrder ?? [];
  target.lineOrder = [...existingOrder, ...sourceOrder.filter((lineId) => !existingOrder.includes(lineId))];
}

function applyCapturedDynamicsByPart(
  score: Score,
  partIndex: number,
  measureIndex: number,
  pasteStartBeat: number,
  captured: CapturedDynamic[] | undefined,
  tracks?: ClipboardTrack[],
  anchorStaffIndex = 0,
): void {
  for (const item of captured ?? []) {
    const destination = capturedAnnotationDestination(
      score,
      partIndex,
      anchorStaffIndex,
      tracks,
      item.partOffset ?? 0,
      item.dynamic.staff ?? 1,
      item.staffOffset,
    );
    applyCapturedDynamics(score, destination.partIndex, measureIndex, pasteStartBeat, [
      destination.staff === undefined ? item : { ...item, dynamic: { ...item.dynamic, staff: destination.staff } },
    ]);
  }
}

function applyCapturedMeasureRepeats(
  score: Score,
  capturedRepeats: CapturedMeasureRepeat[] | undefined,
  partIndex: number,
  measureIndex: number,
): void {
  if (!capturedRepeats) return;
  for (const captured of capturedRepeats) {
    const targetMeasure = score.parts[partIndex + captured.partOffset]?.measures[measureIndex + captured.measureOffset];
    if (targetMeasure) targetMeasure.measureRepeat = structuredClone(captured.repeat);
  }
}

/**
 * Replay captured dynamics into the target part's measures.
 *
 * Absolute `offset` and `endOffset` values are independently mapped from the
 * paste origin across destination measures. `endOffset` is authoritative even
 * when the start uses legacy coordinates or `endMeasureOffset` is also present.
 *
 * Legacy coordinates (used only when the corresponding absolute offset is absent):
 *  - `measureOffset`: offset from the selection's first measure.
 *  - `position`: for `measureOffset === 0`, the position is stored
 *    *relative to the selection window start* (i.e. already shifted so beat 0
 *    means "start of selection"). For later measures, the position is the
 *    original measure-relative position.
 *
 * Legacy paste behavior:
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

  function absoluteDynamicEnd(endOffset: [number, number]) {
    const end = resolveOffsetPosition(score, measureIndex, pasteStartBeat, endOffset, true);
    const endMeasure = score.global.measures[end.measureIndex];
    if (!endMeasure?.id || !score.parts[partIndex]?.measures[end.measureIndex]) return undefined;
    return { measure: endMeasure.id, position: { fraction: quarterBeatsToFraction(end.beat) } };
  }

  function applyOffsetDynamic(c: CapturedDynamic): void {
    const target = resolveOffsetPosition(score, measureIndex, pasteStartBeat, c.offset);
    const targetMeasure = score.parts[partIndex]?.measures[target.measureIndex];
    if (!targetMeasure) return;
    const newDynamic: DynamicGroup = {
      ...structuredClone(c.dynamic),
      id: generateId(),
      position: { fraction: quarterBeatsToFraction(target.beat) },
    };
    if (newDynamic.type === "gradual") {
      if (!c.endOffset) return;
      const end = absoluteDynamicEnd(c.endOffset);
      if (!end) return;
      newDynamic.end = end;
    }
    targetMeasure.dynamics ??= [];
    targetMeasure.dynamics.push(newDynamic);
  }

  for (const c of captured) {
    if (c.offset) {
      applyOffsetDynamic(c);
      continue;
    }
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
      if (c.endOffset) {
        const end = absoluteDynamicEnd(c.endOffset);
        if (!end) continue;
        newDyn.end = end;
      } else {
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
    }

    if (!targetMeasure.dynamics) targetMeasure.dynamics = [];
    targetMeasure.dynamics.push(newDyn);
  }
}

/**
 * Apply a cut operation to a Score model.
 * Replaces cut events with rests of matching duration.
 *
 * Returns a new Score (immutable update).
 */
export function applyCut(score: Score, cut: CutResult): Score {
  const scoreWithoutRepeats = removeCutMeasureRepeats(score, cut.cutMeasureRepeats);
  if (cut.cutLocations && cut.cutLocations.length > 0) {
    const newScore = structuredClone(scoreWithoutRepeats);
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

  if (cut.replacements.length === 0) return deleteCutAnnotations(scoreWithoutRepeats, cut);
  const part = scoreWithoutRepeats.parts[cut.partIndex];
  if (!part) return scoreWithoutRepeats;
  const measure = part.measures[cut.measureIndex];
  if (!measure) return scoreWithoutRepeats;
  const sequence = measure.sequences[cut.sequenceIndex];
  if (!sequence) return scoreWithoutRepeats;

  const newScore = structuredClone(scoreWithoutRepeats);
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

function removeCutMeasureRepeats(
  score: Score,
  locations: Array<{ partIndex: number; measureIndex: number }> | undefined,
): Score {
  if (!locations?.length) return score;
  const next = structuredClone(score);
  for (const location of locations) {
    const measure = next.parts[location.partIndex]?.measures[location.measureIndex];
    if (measure) delete measure.measureRepeat;
  }
  return next;
}

function deleteCutAnnotations(score: Score, cut: CutResult): Score {
  return cut.cutAnnotationLocations?.length ? (deleteAnnotations(score, cut.cutAnnotationLocations) ?? score) : score;
}

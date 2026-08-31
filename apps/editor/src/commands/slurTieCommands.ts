/**
 * Slur and tie commands extracted from noteCommands.ts.
 *
 * Public functions here are re-exported from noteCommands for backwards
 * compatibility — external callers should keep importing from noteCommands.
 */

import type { NoteEvent, Score, SequenceContent } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import { iterAllEvents } from "../keyboard/normalModeDeleteHelpers";
import type { EventLocation } from "../score/ElementPath";
import { generateNoteId } from "./noteCommands";

// ═══════════════════════════════════════════
// Slur operations
// ═══════════════════════════════════════════

export interface AddSlurParams {
  /** Event ID where the slur starts */
  sourceEventId: string;
  /** Event ID where the slur ends */
  targetEventId: string;
  /** Optional slur side at start (MNX side). */
  side?: "up" | "down";
  /** Optional slur side at end (MNX sideEnd). */
  sideEnd?: "up" | "down";
  /** Optional slur line type (MNX lineType). */
  lineType?: "solid" | "dashed" | "dotted";
  /** Optional source note ID inside the source event (MNX startNote). */
  startNote?: string;
  /** Optional target note ID inside the target event (MNX endNote). */
  endNote?: string;
}

function findEventById(score: Score, eventId: string): NoteEvent | null {
  for (const ev of iterAllEvents(score)) {
    if (ev.id === eventId) return ev;
  }
  return null;
}

function noteIdExists(score: Score, noteId: string): boolean {
  for (const ev of iterAllEvents(score)) {
    if (ev.notes && ev.notes.some((n) => n.id === noteId)) return true;
  }
  return false;
}

/**
 * The index path of an event location within its sequence's content tree.
 * `tupletIndex` addresses both tuplet and tremolo containers; a top-level
 * event has no container index.
 */
function locToPath(loc: EventLocation): number[] {
  return loc.tupletIndex !== undefined ? [loc.tupletIndex, loc.eventIndex] : [loc.eventIndex];
}

/** Lexicographic compare of two content index paths (document order). */
function comparePaths(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * Find the id of the first note-bearing event strictly after `loc` in document
 * order — the natural slur target for a single-note "add slur" gesture.
 *
 * The search descends into every event container (tuplet, grace, tremolo) via
 * the canonical `walkSequenceEvents` primitive, then falls through to the next
 * measure's same voice. Rests (events without notes) are skipped. Returns null
 * if no following note exists.
 */
export function findForwardSlurTargetId(score: Score, loc: EventLocation): string | null {
  const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!seq) return null;

  const srcPath = locToPath(loc);
  for (const { event, path } of walkSequenceEvents(seq.content)) {
    if (comparePaths(path, srcPath) <= 0) continue;
    if (event.notes?.length && event.id) return event.id;
  }

  // Fall through to the next measure's same voice (cross-barline slur).
  const nextSeq = score.parts[loc.partIndex]?.measures[loc.measureIndex + 1]?.sequences[loc.sequenceIndex];
  if (nextSeq) {
    for (const { event } of walkSequenceEvents(nextSeq.content)) {
      if (event.notes?.length && event.id) return event.id;
    }
  }
  return null;
}

/**
 * Add a slur from sourceEventId to targetEventId.
 */
export function addSlur(score: Score, params: AddSlurParams): Score {
  const { sourceEventId, targetEventId, side, sideEnd, lineType, startNote, endNote } = params;
  const sourceEvent = findEventById(score, sourceEventId);
  if (!sourceEvent) {
    throw new Error(`Source event ${sourceEventId} not found`);
  }
  if (!findEventById(score, targetEventId)) {
    throw new Error(`Target event ${targetEventId} not found`);
  }
  if (startNote && !noteIdExists(score, startNote)) {
    throw new Error(`Start note ${startNote} not found`);
  }
  if (endNote && !noteIdExists(score, endNote)) {
    throw new Error(`End note ${endNote} not found`);
  }

  const slurEntry: {
    target: string;
    side?: "up" | "down";
    sideEnd?: "up" | "down";
    lineType?: "solid" | "dashed" | "dotted";
    startNote?: string;
    endNote?: string;
  } = { target: targetEventId };
  if (side) slurEntry.side = side;
  if (sideEnd) slurEntry.sideEnd = sideEnd;
  if (lineType) slurEntry.lineType = lineType;
  if (startNote) slurEntry.startNote = startNote;
  if (endNote) slurEntry.endNote = endNote;

  if (sourceEvent.slurs) {
    sourceEvent.slurs.push(slurEntry);
  } else {
    sourceEvent.slurs = [slurEntry];
  }
  return score;
}

// ═══════════════════════════════════════════
// Tie operations
// ═══════════════════════════════════════════

export interface AddTieParams {
  /** Location of the source event */
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  /** If the event is inside a tuplet, the index of the tuplet in seq.content. */
  tupletIndex?: number;
  /** If the event is a grace note, the index of its grace container in seq.content. */
  graceContainerIndex?: number;
}

/** Find the first note-bearing event in a SequenceContent array starting at idx. */
function firstNoteEventFrom(content: SequenceContent[], startIdx: number): NoteEvent | null {
  for (let i = startIdx; i < content.length; i++) {
    const c = content[i];
    if (c?.type === "event" && c.notes && c.notes.length > 0) return c;
    if (c?.type === "tuplet") {
      for (const inner of c.content) {
        if (inner?.type === "event" && inner.notes && inner.notes.length > 0) return inner;
      }
    }
  }
  return null;
}

/** Find the first note event in any subsequent measure (same sequence index). */
function firstNoteEventInFollowingMeasures(
  measures: { sequences: { content: SequenceContent[] }[] }[],
  fromMeasureIdx: number,
  sequenceIndex: number,
): NoteEvent | null {
  for (let m = fromMeasureIdx; m < measures.length; m++) {
    const nextSeq = measures[m]?.sequences[sequenceIndex];
    if (!nextSeq) continue;
    const found = firstNoteEventFrom(nextSeq.content, 0);
    if (found) return found;
  }
  return null;
}

/**
 * Add ties from the source event's notes to the next note event's notes.
 * Returns the mutated score, or null if no valid target found.
 */
export function addTie(score: Score, params: AddTieParams): Score | null {
  const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex } = params;
  const part = score.parts[partIndex];
  if (!part) return null;

  const seq = part.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return null;

  let sourceEv: SequenceContent | undefined;
  let sourceContainer: SequenceContent[];
  if (tupletIndex !== undefined) {
    const t = seq.content[tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    sourceContainer = t.content;
    sourceEv = sourceContainer[eventIndex];
  } else {
    sourceContainer = seq.content;
    sourceEv = sourceContainer[eventIndex];
  }
  if (!sourceEv || sourceEv.type !== "event" || !sourceEv.notes || sourceEv.notes.length === 0) {
    return null;
  }

  // Find next note event: same container → following top-level in parent seq → following measures.
  let targetEv: NoteEvent | null = firstNoteEventFrom(sourceContainer, eventIndex + 1);
  if (!targetEv && tupletIndex !== undefined) {
    targetEv = firstNoteEventFrom(seq.content, tupletIndex + 1);
  }
  if (!targetEv) {
    targetEv = firstNoteEventInFollowingMeasures(part.measures, measureIndex + 1, sequenceIndex);
  }
  if (!targetEv || !targetEv.notes) return null;

  for (const note of sourceEv.notes) {
    if (!note.id) note.id = generateNoteId();
  }
  for (const note of targetEv.notes) {
    if (!note.id) note.id = generateNoteId();
  }

  let anyTied = false;
  for (const srcNote of sourceEv.notes) {
    const matchingTarget = targetEv.notes.find(
      (t) =>
        t.pitch.step === srcNote.pitch.step &&
        t.pitch.octave === srcNote.pitch.octave &&
        (t.pitch.alter ?? 0) === (srcNote.pitch.alter ?? 0),
    );
    if (matchingTarget?.id) {
      srcNote.ties = [{ target: matchingTarget.id }];
      anyTied = true;
    }
  }

  if (!anyTied) return null;
  return score;
}

/**
 * Remove all ties from the notes in the given event.
 */
export function removeTies(score: Score, params: AddTieParams): Score | null {
  const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex } = params;
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return null;
  let ev: SequenceContent | undefined;
  if (tupletIndex !== undefined) {
    const t = seq.content[tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    ev = t.content[eventIndex];
  } else {
    ev = seq.content[eventIndex];
  }
  if (!ev || ev.type !== "event" || !ev.notes) return null;

  for (const note of ev.notes) {
    delete note.ties;
  }
  return score;
}

export interface SetTiePropertiesParams extends AddTieParams {
  noteIndex?: number;
  tieIndex?: number;
  target?: string | null;
  targetType?: string | null;
  side?: string | null;
  lv?: boolean | null;
}

interface TieRecord {
  target?: string;
  targetType?: string;
  side?: string;
  lv?: boolean;
}

/** Apply target/targetType/side/lv mutations to a single tie object. */
function applyTieMutations(tie: TieRecord, params: SetTiePropertiesParams, score: Score): void {
  if ("target" in params) {
    if (params.target && !noteIdExists(score, params.target)) {
      throw new Error(`Tie target note ${params.target} not found`);
    }
    if (params.target) tie.target = params.target;
    else delete tie.target;
  }
  if ("targetType" in params) {
    if (params.targetType) tie.targetType = params.targetType;
    else delete tie.targetType;
  }
  if ("side" in params) {
    if (params.side) tie.side = params.side;
    else delete tie.side;
  }
  if ("lv" in params) {
    if (params.lv === true) {
      tie.lv = true;
      delete tie.target;
    } else if (params.lv === false) {
      tie.lv = false;
    } else {
      delete tie.lv;
    }
  }
}

/**
 * Update advanced properties of a tie on a selected note.
 */
export function setTieProperties(score: Score, params: SetTiePropertiesParams): Score | null {
  const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex, graceContainerIndex } = params;
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return null;
  let event: SequenceContent | undefined;
  if (graceContainerIndex !== undefined) {
    const g = seq.content[graceContainerIndex];
    if (!g || g.type !== "grace") return null;
    event = g.content[eventIndex];
  } else if (tupletIndex !== undefined) {
    const t = seq.content[tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    event = t.content[eventIndex];
  } else {
    event = seq.content[eventIndex];
  }
  if (!event || event.type !== "event" || !event.notes || event.notes.length === 0) return null;

  const noteIndex = params.noteIndex ?? 0;
  const tieIndex = params.tieIndex ?? 0;
  const note = event.notes[noteIndex];
  if (!note) return null;
  if (!note.ties || note.ties.length <= tieIndex) return null;
  const tie = note.ties[tieIndex];
  if (!tie) return null;

  applyTieMutations(tie as TieRecord, params, score);
  return score;
}

export interface SetSlurPropertiesParams extends AddTieParams {
  slurIndex?: number;
  target?: string | null;
  side?: "up" | "down" | null;
  sideEnd?: "up" | "down" | null;
  lineType?: "solid" | "dashed" | "dotted" | null;
  startNote?: string | null;
  endNote?: string | null;
}

interface SlurRecord {
  target?: string;
  side?: "up" | "down";
  sideEnd?: "up" | "down";
  lineType?: "solid" | "dashed" | "dotted";
  startNote?: string;
  endNote?: string;
}

/** Apply the simple optional-string slur fields (side/sideEnd/lineType). */
function applySimpleSlurFields(slur: SlurRecord, params: SetSlurPropertiesParams): void {
  if ("side" in params) {
    if (params.side) slur.side = params.side;
    else delete slur.side;
  }
  if ("sideEnd" in params) {
    if (params.sideEnd) slur.sideEnd = params.sideEnd;
    else delete slur.sideEnd;
  }
  if ("lineType" in params) {
    if (params.lineType) slur.lineType = params.lineType;
    else delete slur.lineType;
  }
}

/** Apply startNote/endNote — validates against score note IDs. */
function applySlurEndpoints(slur: SlurRecord, params: SetSlurPropertiesParams, score: Score): void {
  if ("startNote" in params) {
    if (params.startNote) {
      if (!noteIdExists(score, params.startNote)) {
        throw new Error(`Slur start note ${params.startNote} not found`);
      }
      slur.startNote = params.startNote;
    } else {
      delete slur.startNote;
    }
  }
  if ("endNote" in params) {
    if (params.endNote) {
      if (!noteIdExists(score, params.endNote)) {
        throw new Error(`Slur end note ${params.endNote} not found`);
      }
      slur.endNote = params.endNote;
    } else {
      delete slur.endNote;
    }
  }
}

/**
 * Update advanced properties of an existing slur on a selected event.
 */
export function setSlurProperties(score: Score, params: SetSlurPropertiesParams): Score | null {
  const { partIndex, measureIndex, sequenceIndex, eventIndex, tupletIndex, graceContainerIndex } = params;
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return null;
  let event: SequenceContent | undefined;
  if (graceContainerIndex !== undefined) {
    const g = seq.content[graceContainerIndex];
    if (!g || g.type !== "grace") return null;
    event = g.content[eventIndex];
  } else if (tupletIndex !== undefined) {
    const t = seq.content[tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    event = t.content[eventIndex];
  } else {
    event = seq.content[eventIndex];
  }
  if (!event || event.type !== "event" || !event.slurs || event.slurs.length === 0) return null;

  const slurIndex = params.slurIndex ?? 0;
  const slur = event.slurs[slurIndex];
  if (!slur) return null;

  if ("target" in params) {
    if (!params.target) {
      throw new Error("Slur target is required");
    }
    if (!findEventById(score, params.target)) {
      throw new Error(`Slur target event ${params.target} not found`);
    }
    slur.target = params.target;
  }
  applySimpleSlurFields(slur as SlurRecord, params);
  applySlurEndpoints(slur as SlurRecord, params, score);

  return score;
}

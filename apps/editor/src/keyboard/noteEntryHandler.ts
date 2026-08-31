/**
 * `handleNoteEntry` and supporting helpers — split out of noteInputHandlers.ts
 * to keep the keypress dispatcher slim. Handles letter-key note entry
 * (chord-stacking via Shift, condensing-aware redistribution, fallback append-measure
 * insertion) and the post-entry slur wiring.
 */

import type { Score, Pitch, Duration } from "@viritura/core";
import { appendMeasure, isRest, measureBeats, pitchToMidi } from "@viritura/core";
import { toast } from "sonner";
import {
  addSlur,
  findLastNoteEvent,
  durationToBeats,
  addNoteWithAutoTie,
  addRest,
  addGraceNote,
  addPitchToChord,
} from "../commands/noteCommands";
import {
  findCondensingStaff,
  resolveEditTargets,
  detectCondensingMode,
  getActiveLayoutId,
} from "../score/condensingRouter";
import { redistributeChordAcrossSources } from "../score/condensingChord";
import { getKeySignatureAlter, resolveKeyAtMeasure, resolveEntryPitch } from "../commands/transposeCommands";
import { prevailingAlterationAtPosition } from "../commands/accidentalCommands";
import { getActiveTimeSignature, computeUsedBeats, advanceCursorByNotatedDuration } from "../commands/cursorCommands";
import { closestOctave, aboveOctave, defaultPitchForClef } from "../input/octaveLogic";
import { cloneScore, produce } from "../score/scoreClone";
import type { KeyboardHandlerContext } from "./types";
import {
  resolveActiveClefForStaff,
  normalizePartLocalStaffIndex,
  resolveOttavaShift,
  staffPositionForPitch,
  emitOptimisticNoteInput,
  resolveSeqIndex,
} from "./noteInputShared";

interface EntryContext {
  partIndex: number;
  staffIdx: number;
  cursorMeasure: number;
  cursorBeat: number;
  voice: number;
  activeClef: ReturnType<typeof resolveActiveClefForStaff>;
  ottavaShift: number;
}

function clearExplicitAccidentalAfterPitchedEntry(ctx: KeyboardHandlerContext): void {
  const noteInput = ctx.getNoteInput();
  if (!noteInput.isRest && noteInput.currentAccidental !== null) {
    ctx.setAccidental(null);
  }
}

function buildEntryContext(ctx: KeyboardHandlerContext, currentScore: Score): EntryContext {
  const ni = ctx.getNoteInput();
  const partIndex = ni.cursorPosition?.partIndex ?? 0;
  const staffIdx = normalizePartLocalStaffIndex(currentScore, partIndex, ni.cursorPosition?.staffIndex ?? 0);
  const cursorMeasure = ni.cursorPosition?.measureIndex ?? 0;
  const cursorBeat = ni.cursorPosition?.beatPosition ?? 0;
  const voice = resolveSeqIndex(currentScore, ctx);
  const activeClef = resolveActiveClefForStaff(currentScore, partIndex, staffIdx, cursorMeasure);
  const ottavaShift = resolveOttavaShift(currentScore, partIndex, staffIdx, cursorMeasure, cursorBeat);
  return { partIndex, staffIdx, cursorMeasure, cursorBeat, voice, activeClef, ottavaShift };
}

function applyAccidentalToPitch(
  pitch: Pitch,
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  entryCtx: EntryContext,
): void {
  const ni = ctx.getNoteInput();
  const acc = ni.currentAccidental;
  if (acc === "sharp") pitch.alter = 1;
  else if (acc === "flat") pitch.alter = -1;
  else if (acc === "double-sharp") pitch.alter = 2;
  else if (acc === "double-flat") pitch.alter = -2;
  else if (acc === "triple-sharp") pitch.alter = 3;
  else if (acc === "triple-flat") pitch.alter = -3;
  else if (acc === "natural") pitch.alter = 0;
  else {
    let keyFifths = resolveKeyAtMeasure(currentScore, entryCtx.cursorMeasure);
    const partTransposition = currentScore.parts[entryCtx.partIndex]?.transposition;
    const globalUseWritten = currentScore.scores?.[0]?.useWritten ?? false;
    const prefersWritten = partTransposition?.prefersWrittenPitches ?? false;
    if ((globalUseWritten || prefersWritten) && partTransposition) {
      const flipAt = partTransposition.keyFifthsFlipAt;
      let transposedFifths = keyFifths + partTransposition.interval.halfSteps;
      while (transposedFifths > 7) transposedFifths -= 12;
      while (transposedFifths < -7) transposedFifths += 12;
      if (flipAt !== undefined && Math.abs(transposedFifths) > Math.abs(flipAt)) {
        transposedFifths = transposedFifths > 0 ? transposedFifths - 12 : transposedFifths + 12;
      }
      keyFifths = transposedFifths;
    }
    const keyAlter = getKeySignatureAlter(pitch.step, keyFifths);
    if (keyAlter !== 0) {
      pitch.alter = keyAlter;
    }
  }
}

function buildEntryPitch(
  step: string,
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  entryCtx: EntryContext,
): { pitch: Pitch; writtenPitch: Pitch } {
  const ni = ctx.getNoteInput();
  const typedStep = step as Pitch["step"];
  const refPitch = ni.lastPitch ?? defaultPitchForClef(entryCtx.activeClef, entryCtx.ottavaShift);
  const octave = closestOctave(typedStep, refPitch);
  const written: Pitch = { step: typedStep, octave };
  applyAccidentalToPitch(written, ctx, currentScore, entryCtx);

  // Single source of truth for the written→sounding split (shared with the
  // click path): preview + octave memory use the written pitch, storage uses
  // the sounding pitch.
  let { written: writtenPitch, sounding } = resolveEntryPitch(
    written,
    currentScore,
    entryCtx.partIndex,
    resolveKeyAtMeasure(currentScore, entryCtx.cursorMeasure),
  );
  if (ni.currentAccidental === null) {
    const inheritedAlter = prevailingAlterationAtPosition(
      currentScore,
      entryCtx.partIndex,
      entryCtx.cursorMeasure,
      entryCtx.cursorBeat,
      sounding,
    );
    const soundingDelta = inheritedAlter - (sounding.alter ?? 0);
    if (soundingDelta !== 0) {
      const adjustedWrittenAlter = (writtenPitch.alter ?? 0) + soundingDelta;
      const adjustedWritten = { ...writtenPitch };
      if (adjustedWrittenAlter === 0) delete adjustedWritten.alter;
      else adjustedWritten.alter = adjustedWrittenAlter;
      ({ written: writtenPitch, sounding } = resolveEntryPitch(
        adjustedWritten,
        currentScore,
        entryCtx.partIndex,
        resolveKeyAtMeasure(currentScore, entryCtx.cursorMeasure),
      ));
    }
  }
  if (!ni.isRest) {
    setTimeout(() => ctx.previewPitch(writtenPitch, entryCtx.partIndex), 0);
  }
  return { pitch: sounding, writtenPitch };
}

interface ChordTargetLoc {
  measureIndex: number;
  eventIndex: number;
  beatPos: number;
  beats: number;
}

function findChordTargetLoc(
  currentScore: Score,
  entryCtx: EntryContext,
  cursorMeasureIdx: number,
  cursorBeat: number,
): ChordTargetLoc | null {
  let loc: ChordTargetLoc | null = null;
  const seq = currentScore.parts[entryCtx.partIndex]?.measures[cursorMeasureIdx]?.sequences[entryCtx.voice];
  if (seq) {
    let accBeats = 0;
    for (let i = 0; i < seq.content.length; i++) {
      const ev = seq.content[i];
      if (!ev || ev.type !== "event") continue;
      const evBeats = durationToBeats(ev.duration);
      if (accBeats >= cursorBeat + 1e-9) break;
      if (!isRest(ev)) loc = { measureIndex: cursorMeasureIdx, eventIndex: i, beatPos: accBeats, beats: evBeats };
      accBeats += evBeats;
    }
  }
  if (loc) return loc;
  for (let m = cursorMeasureIdx - 1; m >= 0; m--) {
    const prevSeq = currentScore.parts[entryCtx.partIndex]?.measures[m]?.sequences[entryCtx.voice];
    if (!prevSeq) continue;
    let accBeats = 0;
    let last: ChordTargetLoc | null = null;
    for (let i = 0; i < prevSeq.content.length; i++) {
      const ev = prevSeq.content[i];
      if (!ev || ev.type !== "event") continue;
      const evBeats = durationToBeats(ev.duration);
      if (!isRest(ev)) last = { measureIndex: m, eventIndex: i, beatPos: accBeats, beats: evBeats };
      accBeats += evBeats;
    }
    if (last) return last;
  }
  return null;
}

function updateHighestFromEvent(ev: { notes?: { pitch: Pitch }[] }, current: Pitch | null): Pitch | null {
  let highest = current;
  for (const n of ev.notes ?? []) {
    if (!highest || pitchToMidi(n.pitch) > pitchToMidi(highest)) {
      highest = n.pitch;
    }
  }
  return highest;
}

function findHighestPitchAtLoc(
  currentScore: Score,
  sourcePartIndices: readonly number[],
  loc: ChordTargetLoc,
): Pitch | null {
  let highest: Pitch | null = null;
  for (const pi of sourcePartIndices) {
    const sseq = currentScore.parts[pi]?.measures[loc.measureIndex]?.sequences[0];
    if (!sseq) continue;
    let acc = 0;
    for (const ev of sseq.content) {
      if (ev.type !== "event") continue;
      const evBeats = durationToBeats(ev.duration);
      if (Math.abs(acc - loc.beatPos) < 1e-9 && Math.abs(evBeats - loc.beats) < 1e-9) {
        if (!isRest(ev)) highest = updateHighestFromEvent(ev, highest);
        break;
      }
      if (acc > loc.beatPos + 1e-9) break;
      acc += evBeats;
    }
  }
  return highest;
}

/** Returns true if chord entry was handled (caller should return). */
function tryChordEntry(
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  entryCtx: EntryContext,
  pitch: Pitch,
  writtenPitch: Pitch,
): boolean {
  const ni = ctx.getNoteInput();
  const cursor = ni.cursorPosition;
  const cursorMeasureIdx = cursor?.measureIndex ?? 0;
  const cursorBeat = cursor?.beatPosition ?? 0;

  const layoutId = getActiveLayoutId(currentScore, ctx.getConfig().selectedScoreIndex ?? 0);
  const cs = ni.condensingRouting == null ? findCondensingStaff(currentScore, layoutId, entryCtx.partIndex) : null;

  const loc = findChordTargetLoc(currentScore, entryCtx, cursorMeasureIdx, cursorBeat);

  if (loc && cs) {
    const highestExisting = findHighestPitchAtLoc(currentScore, cs.sourcePartIndices, loc);
    if (highestExisting) {
      pitch.octave = aboveOctave(pitch.step, highestExisting);
      writtenPitch.octave = pitch.octave;
    }
    const resultScore = redistributeChordAcrossSources(currentScore, {
      sourcePartIndices: cs.sourcePartIndices,
      newPitch: pitch,
      duration: { base: ni.currentDuration, ...(ni.dotCount > 0 ? { dots: ni.dotCount } : {}) },
      measureIndex: loc.measureIndex,
      beatPosition: loc.beatPos,
      beats: loc.beats,
    });
    ctx.updateScore(resultScore);
    ctx.setLastPitch(writtenPitch);
    clearExplicitAccidentalAfterPitchedEntry(ctx);
    return true;
  }

  if (loc) {
    const newScore = produce(currentScore, (draft) => {
      const targetEv =
        draft.parts[entryCtx.partIndex]?.measures[loc.measureIndex]?.sequences[entryCtx.voice]?.content[loc.eventIndex];
      if (targetEv && targetEv.type === "event" && targetEv.notes?.length) {
        const highest = targetEv.notes.reduce((hi, n) =>
          n.pitch.octave * 7 + "CDEFGAB".indexOf(n.pitch.step) > hi.pitch.octave * 7 + "CDEFGAB".indexOf(hi.pitch.step)
            ? n
            : hi,
        );
        pitch.octave = aboveOctave(pitch.step, highest.pitch);
      }
      addPitchToChord(draft, {
        pitch,
        measureIndex: loc.measureIndex,
        partIndex: entryCtx.partIndex,
        voice: entryCtx.voice,
        eventIndex: loc.eventIndex,
      });
    });
    if (newScore !== currentScore) {
      ctx.updateScore(newScore);
      ctx.setLastPitch(writtenPitch);
      clearExplicitAccidentalAfterPitchedEntry(ctx);
    }
  } else {
    toast.info("Enter a note first, then use Shift+letter to add to chord");
  }
  return true;
}

interface InsertPlan {
  measureIdx: number;
  beatPos: number;
  noteBeats: number;
  duration: Duration;
  targets: { partIndex: number; voice: number }[];
  cursorTarget: { partIndex: number; voice: number };
}

function planInsert(ctx: KeyboardHandlerContext, currentScore: Score, entryCtx: EntryContext): InsertPlan {
  const ni = ctx.getNoteInput();
  const duration: Duration = {
    base: ni.currentDuration,
    ...(ni.dotCount > 0 ? { dots: ni.dotCount } : {}),
  };
  const noteBeats = durationToBeats(duration);

  const cursor = ni.cursorPosition;
  let measureIdx: number;
  let beatPos: number;
  if (cursor) {
    measureIdx = cursor.measureIndex;
    beatPos = cursor.beatPosition;
  } else {
    measureIdx = 0;
    beatPos = computeUsedBeats(currentScore, 0, entryCtx.partIndex, entryCtx.voice);
  }
  // If cursor is at end of measure, advance to next measure start.
  const ts = getActiveTimeSignature(currentScore, measureIdx);
  const maxBeats = measureBeats(ts);
  if (beatPos >= maxBeats - 1e-9) {
    measureIdx++;
    beatPos = 0;
  }

  const layoutId = getActiveLayoutId(currentScore, ctx.getConfig().selectedScoreIndex ?? 0);
  const condensingStaff =
    ni.condensingRouting != null ? findCondensingStaff(currentScore, layoutId, entryCtx.partIndex) : null;
  const targets: { partIndex: number; voice: number }[] = condensingStaff
    ? resolveEditTargets(
        ni.condensingRouting ?? detectCondensingMode(currentScore, condensingStaff, measureIdx),
        condensingStaff,
        entryCtx.voice,
      )
    : [{ partIndex: entryCtx.partIndex, voice: entryCtx.voice }];
  const cursorTarget = targets.find((t) => t.partIndex === entryCtx.partIndex) ?? targets[0]!;
  return { measureIdx, beatPos, noteBeats, duration, targets, cursorTarget };
}

type InsertKind = "grace-slash" | "grace-acciaccatura" | "rest" | "note";

function insertKindFor(ctx: KeyboardHandlerContext): InsertKind {
  const ni = ctx.getNoteInput();
  if (ni.currentGraceType) {
    return ni.currentGraceType === "grace" ? "grace-slash" : "grace-acciaccatura";
  }
  return ni.isRest ? "rest" : "note";
}

function applyEntryToDraft(draft: Score, kind: InsertKind, pitch: Pitch, plan: InsertPlan, staffIdx: number): void {
  for (const t of plan.targets) {
    if (kind === "grace-slash" || kind === "grace-acciaccatura") {
      addGraceNote(draft, {
        pitch,
        duration: plan.duration,
        measureIndex: plan.measureIdx,
        partIndex: t.partIndex,
        voice: t.voice,
        beatPosition: plan.beatPos,
        slash: kind === "grace-slash",
      });
    } else if (kind === "rest") {
      addRest(draft, {
        duration: plan.duration,
        measureIndex: plan.measureIdx,
        partIndex: t.partIndex,
        voice: t.voice,
        beatPosition: plan.beatPos,
        staffNumber: staffIdx + 1,
      });
    } else {
      addNoteWithAutoTie(draft, {
        pitch,
        duration: plan.duration,
        measureIndex: plan.measureIdx,
        partIndex: t.partIndex,
        voice: t.voice,
        beatPosition: plan.beatPos,
        staffNumber: staffIdx + 1,
      });
    }
  }
}

function advanceAfterInsert(
  ctx: KeyboardHandlerContext,
  resultScore: Score,
  writtenPitch: Pitch,
  plan: InsertPlan,
  entryCtx: EntryContext,
): void {
  ctx.setLastPitch(writtenPitch);
  ctx.setCursor({
    ...advanceCursorByNotatedDuration(
      resultScore,
      { measureIndex: plan.measureIdx, beatPosition: plan.beatPos, partIndex: entryCtx.partIndex },
      plan.noteBeats,
      entryCtx.voice,
      1,
    ),
    staffIndex: entryCtx.staffIdx,
  });
  clearExplicitAccidentalAfterPitchedEntry(ctx);
}

function performInBoundsInsert(
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  entryCtx: EntryContext,
  plan: InsertPlan,
  pitch: Pitch,
  writtenPitch: Pitch,
): void {
  const ni = ctx.getNoteInput();
  emitOptimisticNoteInput({
    cursor: {
      measureIndex: plan.measureIdx,
      beatPosition: plan.beatPos,
      partIndex: entryCtx.partIndex,
      staffIndex: entryCtx.staffIdx,
    },
    staffPosition: staffPositionForPitch(writtenPitch, entryCtx.activeClef),
    duration: ni.currentDuration,
    accidental: ni.currentAccidental,
    isRest: ni.isRest,
  });
  const kind = insertKindFor(ctx);
  try {
    const resultScore = produce(currentScore, (draft) => {
      applyEntryToDraft(draft, kind, pitch, plan, entryCtx.staffIdx);
    });
    ctx.updateScore(resultScore, { start: plan.measureIdx, end: plan.measureIdx });
    advanceAfterInsert(ctx, resultScore, writtenPitch, plan, entryCtx);
  } catch (err) {
    console.error("Failed to add note:", err);
    toast.error("Note entry failed");
  }
}

function performFallbackInsert(
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  entryCtx: EntryContext,
  plan: InsertPlan,
  pitch: Pitch,
  writtenPitch: Pitch,
): void {
  const ni = ctx.getNoteInput();
  emitOptimisticNoteInput({
    cursor: {
      measureIndex: plan.measureIdx,
      beatPosition: plan.beatPos,
      partIndex: entryCtx.partIndex,
      staffIndex: entryCtx.staffIdx,
    },
    staffPosition: staffPositionForPitch(writtenPitch, entryCtx.activeClef),
    duration: ni.currentDuration,
    accidental: ni.currentAccidental,
    isRest: ni.isRest,
  });

  let newScore = cloneScore(currentScore);
  let appendedMeasure = false;
  while (plan.measureIdx >= newScore.global.measures.length) {
    newScore = appendMeasure(newScore);
    appendedMeasure = true;
  }
  const fallbackAffectedMeasures = appendedMeasure
    ? undefined
    : { start: plan.measureIdx, end: Math.min(plan.measureIdx + 1, newScore.global.measures.length - 1) };

  const kind = insertKindFor(ctx);
  try {
    if (kind === "note") {
      let resultScore = newScore;
      for (const t of plan.targets) {
        resultScore = addNoteWithAutoTie(resultScore, {
          pitch,
          duration: plan.duration,
          measureIndex: plan.measureIdx,
          partIndex: t.partIndex,
          voice: t.voice,
          beatPosition: plan.beatPos,
          staffNumber: entryCtx.staffIdx + 1,
        });
      }
      wirePostEntrySlur(resultScore, plan.cursorTarget.partIndex, plan.cursorTarget.voice, ctx);
      ctx.updateScore(resultScore, fallbackAffectedMeasures);
      advanceAfterInsert(ctx, resultScore, writtenPitch, plan, entryCtx);
      return;
    }
    applyEntryToDraft(newScore, kind, pitch, plan, entryCtx.staffIdx);
    ctx.updateScore(newScore, fallbackAffectedMeasures);
    wirePostEntrySlur(newScore, plan.cursorTarget.partIndex, plan.cursorTarget.voice, ctx);
    advanceAfterInsert(ctx, newScore, writtenPitch, plan, entryCtx);
  } catch (err) {
    console.error("Failed to add note:", err);
    toast.error("Note entry failed");
  }
}

/** Enter a note by letter name. */
export function handleNoteEntry(step: string, isChord: boolean, ctx: KeyboardHandlerContext): void {
  const currentScore = ctx.getScore();
  if (!currentScore) return;
  const entryCtx = buildEntryContext(ctx, currentScore);

  if (isChord) {
    const { pitch, writtenPitch } = buildEntryPitch(step, ctx, currentScore, entryCtx);
    tryChordEntry(ctx, currentScore, entryCtx, pitch, writtenPitch);
    return;
  }

  const plan = planInsert(ctx, currentScore, entryCtx);
  const plannedEntryCtx = { ...entryCtx, cursorMeasure: plan.measureIdx, cursorBeat: plan.beatPos };
  const { pitch, writtenPitch } = buildEntryPitch(step, ctx, currentScore, plannedEntryCtx);
  const ts = getActiveTimeSignature(currentScore, plan.measureIdx);
  const maxBeats = measureBeats(ts);
  const ni = ctx.getNoteInput();
  const inBounds =
    plan.measureIdx < currentScore.global.measures.length &&
    plan.beatPos + plan.noteBeats <= maxBeats + 1e-9 &&
    !ni.slurActive;

  if (inBounds) {
    performInBoundsInsert(ctx, currentScore, entryCtx, plan, pitch, writtenPitch);
    return;
  }
  performFallbackInsert(ctx, currentScore, entryCtx, plan, pitch, writtenPitch);
}

/** Wire slur after note entry (connects start→end when two notes entered). */
function wirePostEntrySlur(
  scoreAfterEntry: Score,
  partIdx: number,
  voiceIdx: number,
  ctx: KeyboardHandlerContext,
): void {
  const ni = ctx.getNoteInput();
  if (!ni.slurActive) return;
  const loc = findLastNoteEvent(scoreAfterEntry, partIdx, voiceIdx);
  if (!loc) return;
  const ev = scoreAfterEntry.parts[partIdx]?.measures[loc.measureIndex]?.sequences[voiceIdx]?.content[loc.eventIndex];
  if (!ev || ev.type !== "event" || !ev.id) return;

  const startId = ni.slurStartEventId;
  if (!startId) {
    ctx.setSlurStart(ev.id);
  } else {
    addSlur(scoreAfterEntry, {
      sourceEventId: startId,
      targetEventId: ev.id,
    });
    ctx.clearSlurStart();
  }
}

// Re-export `Octave` so callers continue to see it via this module if needed.

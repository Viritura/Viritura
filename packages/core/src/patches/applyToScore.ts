/**
 * Immer-based interpreter that applies a `ScorePatch[]` to a Score.
 *
 * Convergence with peers is handled out-of-band by the CRDT layer in
 * `@viritura/crdt`: after this interpreter mutates the Score, the bridge
 * re-serialises to MNX JSON and runs structural sync against the Y.Doc.
 * There is no separate Y-transaction interpreter for patches.
 */

import { produce, type Draft } from "immer";
import type { Score } from "../model/score";
import type { NoteEvent } from "../model/event";
import type { NonArpeggio, PartMeasure, PartMeasureArpeggio, RhythmicPosition } from "../model/measure";
import { findEvent, findNoteIndex, findOwningContentArray } from "./locate";
import { PatchTargetMissing } from "./locate";
import {
  applyInsertMeasures,
  applyRemoveMeasures,
  applySetGlobalMeasureField,
  applySetPartMeasureField,
  applySetSequenceContent,
} from "./structuralEdits";
import {
  applyAddPart,
  applyRemovePart,
  applySetPartField,
  applySetScoreExtension,
  applySetScoreMetadata,
} from "./scoreEdits";
import type { ArpeggioMarkKind, MeasurePath, ScorePatch } from "./types";

/**
 * Apply a list of patches to a Score, returning a new Score. The input is not
 * mutated. Order matters: patches are applied sequentially in array order.
 *
 * Throws `PatchTargetMissing` if any patch's locator does not resolve. This is
 * a programming-error signal (the planner produced a patch against stale
 * state) rather than a user-error; callers should not catch it routinely.
 */
export function applyPatchesToScore(score: Score, patches: readonly ScorePatch[]): Score {
  if (patches.length === 0) return score;
  return produce(score, (draft) => {
    for (const p of patches) {
      applyOnePatch(draft, p);
    }
  });
}

/* eslint-disable-next-line complexity, max-statements -- the statement/branch
 * count is one per variant of a closed discriminated union; the exhaustiveness
 * guard at the bottom is what we want the compiler to enforce, not what we want
 * to split across files. */
function applyOnePatch(draft: Draft<Score>, p: ScorePatch): void {
  switch (p.kind) {
    case "setNotePitch": {
      const { event, index } = findNoteIndex(draft as Score, p.locator, p.noteId);
      // Cast: Immer's Draft<NoteEvent>.notes is a Draft array; the runtime
      // shape is identical to NoteEvent, so writing through is safe.
      (event as NoteEvent).notes![index]!.pitch = p.pitch;
      return;
    }
    case "setNoteField": {
      const { event, index } = findNoteIndex(draft as Score, p.locator, p.noteId);
      const note = (event as NoteEvent).notes![index]!;
      switch (p.update.field) {
        case "accidentalDisplay":
          if (p.update.value === undefined) delete note.accidentalDisplay;
          else note.accidentalDisplay = p.update.value;
          return;
        case "ties":
          if (p.update.value === undefined) delete note.ties;
          // Cast: model `Note.ties` is derived from MNX raw and narrows
          // `targetType` / `side` to MNX-spec unions, while the patch
          // payload's `Tie` type keeps the looser legacy string shape
          // (see model/event.ts). Runtime values respect the narrow
          // union; the cast just bridges the typing gap.
          else note.ties = p.update.value;
          return;
        case "written":
          if (p.update.value === undefined) delete note.written;
          else note.written = p.update.value;
          return;
        case "staff":
          if (p.update.value === undefined) delete note.staff;
          else note.staff = p.update.value;
          return;
        default: {
          const _exhaustive: never = p.update;
          throw new Error(`Unhandled NoteScalarField: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
    case "addNoteToEvent": {
      const event = findEvent(draft as Score, p.locator) as NoteEvent;
      const notes = event.notes ?? (event.notes = []);
      if (p.index === undefined || p.index >= notes.length) {
        notes.push(p.note);
      } else {
        notes.splice(Math.max(0, p.index), 0, p.note);
      }
      // Adding a note implicitly clears any rest marker on the event.
      delete event.rest;
      return;
    }
    case "removeNoteFromEvent": {
      const { event, index } = findNoteIndex(draft as Score, p.locator, p.noteId);
      (event as NoteEvent).notes!.splice(index, 1);
      return;
    }
    case "setEventField": {
      const event = findEvent(draft as Score, p.locator) as NoteEvent;
      switch (p.update.field) {
        case "duration":
          event.duration = p.update.value;
          return;
        case "stemDirection":
          if (p.update.value === undefined) delete event.stemDirection;
          else event.stemDirection = p.update.value;
          return;
        case "orient":
          if (p.update.value === undefined) delete event.orient;
          else event.orient = p.update.value;
          return;
        case "staff":
          if (p.update.value === undefined) delete event.staff;
          else event.staff = p.update.value;
          return;
        case "slurs":
          if (p.update.value === undefined) delete event.slurs;
          else event.slurs = p.update.value;
          return;
        case "fermata":
          if (p.update.value === undefined) delete event.fermata;
          else event.fermata = p.update.value;
          return;
        default: {
          const _exhaustive: never = p.update;
          throw new Error(`Unhandled EventScalarField: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
    case "setEventMarking": {
      const event = findEvent(draft as Score, p.locator) as NoteEvent;
      if (p.value === undefined) {
        if (!event.markings) return;
        delete event.markings[p.markingKey];
        // Drop the markings object entirely once empty so structural equality
        // checks (and the Y projection round-trip) stay clean.
        if (Object.keys(event.markings).length === 0) delete event.markings;
        return;
      }
      const markings = event.markings ?? (event.markings = {});
      // Cast: the patch's type-level constraint is K → Markings[K], but
      // after we collapse it to `keyof Markings` here we lose the link.
      // Runtime shape is preserved because the builder enforces it.
      (markings as Record<string, unknown>)[p.markingKey] = p.value;
      return;
    }
    case "setMeasureDynamicGroup": {
      const partMeasure = resolveMeasure(draft as Score, p.measurePath);
      const dynamics = partMeasure.dynamics;
      const existingIdx = dynamics ? dynamics.findIndex((d) => d.id === p.groupId) : -1;
      if (p.value === undefined) {
        if (!dynamics || existingIdx < 0) return;
        dynamics.splice(existingIdx, 1);
        if (dynamics.length === 0) delete partMeasure.dynamics;
        return;
      }
      const entry = { ...p.value, id: p.groupId };
      if (!dynamics) {
        partMeasure.dynamics = [entry];
        return;
      }
      if (existingIdx >= 0) dynamics.splice(existingIdx, 1, entry);
      else dynamics.push(entry);
      return;
    }
    case "setMeasureArpeggio": {
      const partMeasure = resolveMeasure(draft as Score, p.measurePath);
      clearArpeggioAt(partMeasure, p.position, p.span);
      if (p.mark === undefined) return;
      installArpeggio(partMeasure, p.position, p.span, p.mark);
      return;
    }
    case "spliceSequenceContent": {
      // Identify the owning content array via the `from` anchor; the `to`
      // anchor must live in the same array.
      const fromHit = findOwningContentArray(draft as Score, {
        sequencePath: p.sequencePath,
        eventId: p.removeFromEventId,
      });
      const toHit = findOwningContentArray(draft as Score, {
        sequencePath: p.sequencePath,
        eventId: p.removeToEventId,
      });
      if (fromHit.container !== toHit.container) {
        throw new PatchTargetMissing(
          `spliceSequenceContent: anchors "${p.removeFromEventId}" and "${p.removeToEventId}" are in different containers`,
        );
      }
      const startIdx = Math.min(fromHit.index, toHit.index);
      const endIdx = Math.max(fromHit.index, toHit.index);
      fromHit.container.splice(startIdx, endIdx - startIdx + 1, ...p.insert);
      return;
    }
    case "setGlobalMeasureField":
      applySetGlobalMeasureField(draft, p);
      return;
    case "insertMeasures":
      applyInsertMeasures(draft, p);
      return;
    case "removeMeasures":
      applyRemoveMeasures(draft, p);
      return;
    case "setPartMeasureField":
      applySetPartMeasureField(draft, p);
      return;
    case "setSequenceContent":
      applySetSequenceContent(draft, p);
      return;
    case "addPart":
      applyAddPart(draft, p);
      return;
    case "removePart":
      applyRemovePart(draft, p);
      return;
    case "setPartField":
      applySetPartField(draft, p);
      return;
    case "setScoreMetadata":
      applySetScoreMetadata(draft, p);
      return;
    case "setScoreExtension":
      applySetScoreExtension(draft, p);
      return;
    default: {
      const _exhaustive: never = p;
      throw new Error(`Unhandled ScorePatch kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ── measure-level helpers ───────────────────────────────────────

function resolveMeasure(draft: Draft<Score>, path: MeasurePath): Draft<PartMeasure> {
  const score = draft as Score;
  const part = score.parts.find((pt) => pt.id === path.partId);
  if (!part) throw new PatchTargetMissing(`Part "${path.partId}" not found`);
  const measure = part.measures[path.measureIndex];
  if (!measure) throw new PatchTargetMissing(`Measure ${path.measureIndex} not found in part "${path.partId}"`);
  return measure as Draft<PartMeasure>;
}

function samePosition(a: RhythmicPosition, b: RhythmicPosition): boolean {
  return a.fraction[0] === b.fraction[0] && a.fraction[1] === b.fraction[1];
}

function sameSpan(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start === b.start && a.end === b.end;
}

function clearArpeggioAt(
  partMeasure: Draft<PartMeasure>,
  position: RhythmicPosition,
  span: { start: string; end: string },
): void {
  if (partMeasure.arpeggios) {
    partMeasure.arpeggios = partMeasure.arpeggios.filter(
      (item) => !(samePosition(item.position, position) && sameSpan(item.span, span)),
    );
    if (partMeasure.arpeggios.length === 0) delete partMeasure.arpeggios;
  }
  if (partMeasure.nonArpeggios) {
    partMeasure.nonArpeggios = partMeasure.nonArpeggios.filter(
      (item) => !(samePosition(item.position, position) && sameSpan(item.span, span)),
    );
    if (partMeasure.nonArpeggios.length === 0) delete partMeasure.nonArpeggios;
  }
}

function installArpeggio(
  partMeasure: Draft<PartMeasure>,
  position: RhythmicPosition,
  span: { start: string; end: string },
  mark: ArpeggioMarkKind,
): void {
  if (mark === "nonArpeggio") {
    const entry: NonArpeggio = { position, span };
    if (!partMeasure.nonArpeggios) partMeasure.nonArpeggios = [entry];
    else partMeasure.nonArpeggios.push(entry);
    return;
  }
  const entry: PartMeasureArpeggio = {
    position,
    span,
    direction: mark === "plain" ? "auto" : mark,
    arrow: mark !== "plain",
  };
  if (!partMeasure.arpeggios) partMeasure.arpeggios = [entry];
  else partMeasure.arpeggios.push(entry);
}

/**
 * Normal mode keyboard handlers.
 *
 * Handlers for: Delete/Backspace, transpose (ArrowUp/Down), slur (S),
 * tie (T), chord stack (I/V), duration change (1-7),
 * edit transforms (Q - rest toggle), and inspector keys (Y/L/G/D/O/R/E/W/B/C).
 */

import type { Score, NoteValueBase, ScorePatch, SequenceContent } from "@viritura/core";
import { patch, walkSequenceEvents } from "@viritura/core";
import {
  addSlur,
  addTie,
  removeTies,
  changeDuration,
  toggleRestAtLocations,
  toggleDotAtLocations,
  generateEventId,
} from "../commands/noteCommands";
import {
  planTransposeNotes,
  resolveKeyAtMeasure,
  transposeNotes,
  transposePitchChromatic,
  transposePitchDiatonic,
} from "../commands/transposeCommands";
import {
  resolveEventLocation,
  resolveGraceLocation,
  getEventAncestorId,
  getEventAtLocation,
  type EventLocation,
  type GraceLocation,
} from "../score/ElementPath";
import { resolveRangeGraceElementIds, resolveSelectionNotes, groupEventsByVoice } from "../store/selectionUtils";
import { resolveCondensedSelectionEvents, resolveCondensedSelectionNotes } from "../score/condensedWriteback";
import { isAnnotationId, findAnnotationOtherSide } from "../navigation/annotationNav";
import { cloneScore } from "../score/scoreClone";

import { findAdjacentPart } from "../navigation/NavigationIndex";
import type { AccidentalType } from "@viritura/core";
import type { KeyboardHandlerContext } from "./types";
import { resolveActiveClefForStaff, staffPositionForPitch } from "./noteInputShared";
import { OPTIMISTIC_NOTE_INPUT_EVENT, type OptimisticNoteInputDetail } from "../components/inputCursorHelpers";
import { planSlurSinglePatch, planSlurSpanPatches } from "./spannerPatchPlans";
export { handleFlip } from "./flipSelection";

/** Convert AccidentalType to numeric alter value. */
function accidentalToAlter(acc: AccidentalType): number {
  switch (acc) {
    case "triple-flat":
      return -3;
    case "double-flat":
      return -2;
    case "flat":
      return -1;
    case "natural":
      return 0;
    case "sharp":
      return 1;
    case "double-sharp":
      return 2;
    case "triple-sharp":
      return 3;
  }
}

/** Apply an accidental to all notes in the selected event(s) (direct set). */
/** Apply an accidental to all notes in the selected event(s) (direct set). */
export function applyAccidentalToSelection(accidental: AccidentalType, ctx: KeyboardHandlerContext): boolean {
  const alter = accidentalToAlter(accidental);
  return mutateSelectedNoteAlters(ctx, () => alter);
}

/** Lowest/highest alteration the stepper allows (triple-flat … triple-sharp). */
const MIN_ALTER = -3;
const MAX_ALTER = 3;

function emitOptimisticPitchPreview(
  ctx: KeyboardHandlerContext,
  score: Score,
  location: EventLocation,
  pitch: import("@viritura/core").Pitch,
): void {
  const event = getEventAtLocation(score, location);
  if (event?.type !== "event") return;
  const navigation = ctx
    .getNavIndex()
    ?.entries.find(
      (entry) =>
        entry.partIndex === location.partIndex &&
        entry.measureIndex === location.measureIndex &&
        entry.sequenceIndex === location.sequenceIndex &&
        entry.eventIndex === location.eventIndex,
    );
  if (!navigation) return;
  const note = event.notes?.[location.noteIndex ?? 0];
  const staffIndex = Math.max(0, (note?.staff ?? event.staff ?? 1) - 1);
  const clef = resolveActiveClefForStaff(score, location.partIndex, staffIndex, location.measureIndex);
  const alter = pitch.alter ?? 0;
  const detail: OptimisticNoteInputDetail = {
    cursor: {
      measureIndex: location.measureIndex,
      beatPosition: navigation.sortKey,
      partIndex: location.partIndex,
      staffIndex,
    },
    staffPosition: staffPositionForPitch(pitch, clef),
    duration: event.duration.base,
    accidental: alter > 0 ? "sharp" : alter < 0 ? "flat" : null,
    isRest: false,
    optimisticOnly: true,
    currentVoice: location.sequenceIndex + 1,
  };
  performance.mark("viritura:input-event");
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_NOTE_INPUT_EVENT, { detail }));
}

/**
 * Nudge every selected note's alteration up (+1 = sharper) or down (-1 = flatter)
 * relative to its own current `alter`, clamped to triple-flat … triple-sharp.
 */
export function stepAccidentalOnSelection(direction: 1 | -1, ctx: KeyboardHandlerContext): boolean {
  return mutateSelectedNoteAlters(ctx, (cur) => Math.max(MIN_ALTER, Math.min(MAX_ALTER, cur + direction)));
}

function planAccidentalPatches(
  score: Score,
  targets: ReturnType<typeof resolveSelectionNotes>,
  transform: (currentAlter: number) => number,
): ScorePatch[] | null {
  const patches: ScorePatch[] = [];
  for (const target of targets) {
    const part = score.parts[target.loc.partIndex];
    const event = getEventAtLocation(score, target.loc);
    if (!part?.id || event?.type !== "event" || !event.id || !event.notes?.length) return null;
    const noteIndices = target.notes === "all" ? event.notes.map((_, index) => index) : target.notes;
    for (const noteIndex of noteIndices) {
      const note = event.notes[noteIndex];
      if (!note?.id) return null;
      const next = transform(note.pitch.alter ?? 0);
      patches.push(
        patch.setNotePitch(
          {
            sequencePath: {
              partId: part.id,
              measureIndex: target.loc.measureIndex,
              voice: target.loc.sequenceIndex,
            },
            eventId: event.id,
          },
          note.id,
          { ...note.pitch, alter: next === 0 ? undefined : next },
        ),
      );
    }
  }
  return patches.length > 0 ? patches : null;
}

/**
 * Shared driver for the note-level accidental edits. Resolves the selection to
 * note-level targets (notehead-aware, so a single selected notehead of a chord
 * is the only note touched) and applies `transform` to each covered note's
 * absolute `alter`. An alter of 0 is stored as `undefined` (natural).
 */
function mutateSelectedNoteAlters(ctx: KeyboardHandlerContext, transform: (currentAlter: number) => number): boolean {
  const currentScore = ctx.getScore();
  const sel = ctx.getSelection();
  if (!currentScore || sel.kind === "none") return false;

  const targets = resolveSelectionNotes(sel, currentScore);
  if (targets.length === 0) return false;

  const patches = planAccidentalPatches(currentScore, targets, transform);
  if (patches) {
    const first = targets[0];
    const event = first ? getEventAtLocation(currentScore, first.loc) : null;
    const noteIndex = first?.notes === "all" ? 0 : first?.notes[0];
    const note = event?.type === "event" && noteIndex !== undefined ? event.notes?.[noteIndex] : undefined;
    if (first && note) {
      const alter = transform(note.pitch.alter ?? 0);
      emitOptimisticPitchPreview(ctx, currentScore, { ...first.loc, noteIndex }, { ...note.pitch, alter });
    }
    ctx.commitPatches(patches);
    return true;
  }

  const newScore = cloneScore(currentScore);
  let changed = false;
  for (const target of targets) {
    const ev = getEventAtLocation(newScore, target.loc);
    if (!ev || ev.type !== "event" || !ev.notes?.length) continue;
    ev.notes.forEach((note, i) => {
      if (target.notes !== "all" && !target.notes.includes(i)) return;
      const next = transform(note.pitch.alter ?? 0);
      note.pitch = { ...note.pitch, alter: next === 0 ? undefined : next };
      changed = true;
    });
  }
  if (!changed) return false;
  ctx.updateScore(newScore);
  return true;
}

export function applyEditTransform(action: "toggleRest" | "toggleDot", ctx: KeyboardHandlerContext): boolean {
  const currentScore = ctx.getScore();
  const sel = ctx.getSelection();
  if (!currentScore || sel.kind === "none") return false;

  const locations = resolveCondensedSelectionEvents(currentScore, sel, ctx.getConfig?.().selectedScoreIndex ?? 0);
  if (locations.length === 0) return false;

  const newScore = cloneScore(currentScore);
  const changed =
    action === "toggleRest" ? toggleRestAtLocations(newScore, locations) : toggleDotAtLocations(newScore, locations);
  if (!changed) return false;

  ctx.updateScore(newScore);
  return true;
}

/** Apply a computed deletion: when it produced a new score, prevent the
 *  default keystroke, commit it, and clear the selection. Returns whether the
 *  deletion took effect, so callers can early-return. */

/** ArrowUp/Down in normal mode: transpose or navigate annotations/voices. */
/** Apply a transpose to all selected note locations and update the score. */
function locationKey(location: EventLocation): string {
  return `${location.partIndex}/${location.measureIndex}/${location.sequenceIndex}/${location.tupletIndex ?? -1}/${location.eventIndex}`;
}

function selectedGraceIds(selection: ReturnType<KeyboardHandlerContext["getSelection"]>, score: Score): string[] {
  switch (selection.kind) {
    case "single":
      return [selection.elementId];
    case "multi":
      return [...selection.elementIds];
    case "range":
      return resolveRangeGraceElementIds(selection.startElementId, selection.endElementId, score);
    default:
      return [];
  }
}

function transposeSelectedGraceNotes(
  score: Score,
  graceIds: readonly string[],
  mode: "chromatic" | "diatonic",
  amount: number,
): void {
  for (const id of graceIds) {
    const graceLoc = resolveGraceLocation(id, score);
    if (!graceLoc) continue;
    const sequence =
      score.parts[graceLoc.partIndex]?.measures[graceLoc.measureIndex]?.sequences[graceLoc.sequenceIndex];
    const tuplet = graceLoc.tupletIndex === undefined ? undefined : sequence?.content[graceLoc.tupletIndex];
    const content =
      graceLoc.tupletIndex === undefined ? sequence?.content : tuplet?.type === "tuplet" ? tuplet.content : undefined;
    const grace = content?.[graceLoc.graceContainerIndex];
    const event = grace?.type === "grace" ? grace.content[graceLoc.graceNoteIndex] : undefined;
    if (!event?.notes) continue;
    const keyFifths = resolveKeyAtMeasure(score, graceLoc.measureIndex);
    for (const note of event.notes) {
      note.pitch =
        mode === "chromatic"
          ? transposePitchChromatic(note.pitch, amount)
          : transposePitchDiatonic(note.pitch, amount, keyFifths);
    }
  }
}

function applyTransposeToSelection(
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  sel: ReturnType<KeyboardHandlerContext["getSelection"]>,
  mode: "chromatic" | "diatonic",
  amount: number,
): void {
  const graceIds = selectedGraceIds(sel, currentScore);
  const hasSelectedGrace = graceIds.some((id) => resolveGraceLocation(id, currentScore) !== null);
  const implicitGraceParents = new Set(
    graceIds.flatMap((id) => {
      const graceLoc = resolveGraceLocation(id, currentScore);
      if (!graceLoc) return [];
      return [locationKey({ ...graceLoc, eventIndex: graceLoc.graceContainerIndex + 1 })];
    }),
  );
  const explicitlySelectedParents = new Set(
    graceIds.length === 0
      ? []
      : graceIds
          .filter((id) => resolveGraceLocation(id, currentScore) === null)
          .flatMap((id) => {
            const parent = resolveEventLocation(getEventAncestorId(id), currentScore);
            return parent ? [locationKey(parent)] : [];
          }),
  );
  const suppressImplicitGraceParents = sel.kind === "single" || sel.kind === "multi";
  const locations = resolveCondensedSelectionNotes(currentScore, sel, ctx.getConfig?.().selectedScoreIndex ?? 0).filter(
    (location) => {
      if (!suppressImplicitGraceParents) return true;
      const key = locationKey(location);
      if (!implicitGraceParents.has(key)) return true;
      return explicitlySelectedParents.has(key);
    },
  );
  if (locations.length === 0 && !hasSelectedGrace) return;

  // Grace notes live inside a container rather than an addressable event path,
  // so the ID-addressed patch interpreter cannot transpose them. Apply the
  // complete mixed selection in one immutable update when a grace is present.
  if (hasSelectedGrace) {
    const newScore = transposeNotes(currentScore, locations, mode, amount);
    transposeSelectedGraceNotes(newScore, graceIds, mode, amount);
    ctx.updateScore(newScore);
    return;
  }

  const patches = planTransposeNotes(currentScore, locations, mode, amount);
  if (patches) {
    const first = locations[0];
    const event = first ? getEventAtLocation(currentScore, first) : null;
    const note = event?.type === "event" ? event.notes?.[first?.noteIndex ?? 0] : undefined;
    if (first && note) {
      const pitch =
        mode === "chromatic"
          ? transposePitchChromatic(note.pitch, amount)
          : transposePitchDiatonic(note.pitch, amount, resolveKeyAtMeasure(currentScore, first.measureIndex));
      emitOptimisticPitchPreview(ctx, currentScore, first, pitch);
    }
    ctx.commitPatches(patches);
  } else {
    const newScore = transposeNotes(currentScore, locations, mode, amount);
    ctx.updateScore(newScore);
  }
}

/** Alt+Arrow on an annotation: navigate to the annotation on the matched side. */
function handleAnnotationArrowNav(
  e: KeyboardEvent,
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  elementId: string,
): boolean {
  if (!isAnnotationId(elementId)) return false;
  e.preventDefault();
  const target = findAnnotationOtherSide(currentScore, elementId);
  if (target) ctx.selectElement(target);
  return true;
}

/** Plain/Shift+Arrow: navigate or extend selection across staves. */
function handleCrossStaffArrow(
  e: KeyboardEvent,
  ctx: KeyboardHandlerContext,
  sel: ReturnType<KeyboardHandlerContext["getSelection"]>,
): void {
  const currentId =
    sel.kind === "single"
      ? sel.elementId
      : sel.kind === "range"
        ? sel.endElementId
        : sel.kind === "multi"
          ? sel.elementIds[sel.elementIds.length - 1]
          : undefined;
  if (!currentId) return;
  const ni = ctx.getNavIndex();
  if (!ni) return;
  const direction = e.key === "ArrowUp" ? ("up" as const) : ("down" as const);
  const target = findAdjacentPart(ni, getEventAncestorId(currentId), direction);
  if (!target) return;
  e.preventDefault();
  if (e.shiftKey) {
    ctx.extendSelection(target);
  } else {
    ctx.selectElement(target);
  }
}

export function handleArrowUpDown(e: KeyboardEvent, mod: boolean, ctx: KeyboardHandlerContext): void {
  const sel = ctx.getSelection();
  const currentScore = ctx.getScore();
  if (!currentScore) return;

  // Mod+Alt+Arrow: octave transpose
  if (mod && e.altKey && !e.shiftKey && sel.kind !== "none") {
    e.preventDefault();
    applyTransposeToSelection(ctx, currentScore, sel, "chromatic", e.key === "ArrowUp" ? 12 : -12);
    return;
  }

  // Alt+Arrow: Annotation navigation
  if (e.altKey && !mod && !e.shiftKey && sel.kind === "single") {
    if (handleAnnotationArrowNav(e, ctx, currentScore, sel.elementId)) return;
  }

  // Alt+Arrow (no Shift): diatonic step
  if (e.altKey && !mod && !e.shiftKey && sel.kind !== "none") {
    e.preventDefault();
    applyTransposeToSelection(ctx, currentScore, sel, "diatonic", e.key === "ArrowUp" ? 1 : -1);
    return;
  }

  // Shift+Alt+Arrow: chromatic half-step
  if (e.shiftKey && e.altKey && !mod && sel.kind !== "none") {
    e.preventDefault();
    applyTransposeToSelection(ctx, currentScore, sel, "chromatic", e.key === "ArrowUp" ? 1 : -1);
    return;
  }

  // Arrow or Shift+Arrow (no Alt/Ctrl): Cross-staff navigation — standard
  if (!mod && !e.altKey && sel.kind !== "none") {
    handleCrossStaffArrow(e, ctx, sel);
  }
}

/** Find the next event ID after `loc` to use as a slur target. Mutates the event to assign an ID if missing. */
function findNextEventIdForSlur(
  newScore: Score,
  loc: ReturnType<typeof resolveEventLocation> & object,
): string | undefined {
  const sequence = newScore.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (sequence) {
    const sourcePath = loc.tupletIndex === undefined ? [loc.eventIndex] : [loc.tupletIndex, loc.eventIndex];
    for (const { event, path } of walkSequenceEvents(sequence.content)) {
      const sharedLength = Math.min(path.length, sourcePath.length);
      let order = path.length - sourcePath.length;
      for (let index = 0; index < sharedLength; index++) {
        if (path[index] === sourcePath[index]) continue;
        order = path[index]! - sourcePath[index]!;
        break;
      }
      if (order <= 0 || !event.notes?.length) continue;
      if (!event.id) event.id = generateEventId();
      return event.id;
    }
  }
  const part = newScore.parts[loc.partIndex];
  if (!part || loc.measureIndex + 1 >= part.measures.length) return undefined;
  const nextSeq = part.measures[loc.measureIndex + 1]?.sequences[loc.sequenceIndex];
  if (!nextSeq) return undefined;
  for (const { event } of walkSequenceEvents(nextSeq.content)) {
    if (!event.notes?.length) continue;
    if (!event.id) event.id = generateEventId();
    return event.id;
  }
  return undefined;
}

/**
 * Add one slur per voice across a set of covered events. A slur can't reach
 * across staves/voices, so a multi-staff selection produces one slur on each
 * staff (first → last covered note in that voice). Voices with a single
 * covered note are skipped — there's nothing to span within them. Mutates a
 * single clone and commits once.
 */
function handleSlurSpanGroups(ctx: KeyboardHandlerContext, currentScore: Score, events: EventLocation[]): void {
  const patches = planSlurSpanPatches(currentScore, events);
  if (patches) {
    ctx.commitPatches(patches);
    return;
  }

  const newScore = cloneScore(currentScore);
  let added = false;
  for (const group of groupEventsByVoice(events)) {
    if (group.length < 2) continue;
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    const srcEv = getEventAtLocation(newScore, first);
    const tgtEv = getEventAtLocation(newScore, last);
    if (!srcEv || srcEv.type !== "event" || !tgtEv || tgtEv.type !== "event") continue;
    if (!srcEv.id) srcEv.id = generateEventId();
    if (!tgtEv.id) tgtEv.id = generateEventId();
    try {
      addSlur(newScore, { sourceEventId: srcEv.id, targetEventId: tgtEv.id });
      added = true;
    } catch {
      /* slur add failed for this voice — keep going */
    }
  }
  if (added) ctx.updateScore(newScore);
}

/** Toggle (add or remove) a slur on a single covered event, slurring to the next event. */
function handleSlurSingleLoc(ctx: KeyboardHandlerContext, currentScore: Score, loc: EventLocation): void {
  const event = getEventAtLocation(currentScore, loc);
  if (!event || event.type !== "event") return;
  const plannedPatch = planSlurSinglePatch(currentScore, loc);
  if (plannedPatch) {
    ctx.commitPatches([plannedPatch]);
    return;
  }

  if (event.slurs && event.slurs.length > 0) {
    const newScore = cloneScore(currentScore);
    const ev = getEventAtLocation(newScore, loc);
    if (ev && "slurs" in ev) {
      delete ev.slurs;
      ctx.updateScore(newScore);
    }
    return;
  }

  const newScore = cloneScore(currentScore);
  const srcEv = getEventAtLocation(newScore, loc);
  if (!srcEv || srcEv.type !== "event") return;
  if (!srcEv.id) srcEv.id = generateEventId();
  const fallbackTargetEventId = findNextEventIdForSlur(newScore, loc);
  if (!fallbackTargetEventId) return;
  try {
    addSlur(newScore, { sourceEventId: srcEv.id, targetEventId: fallbackTargetEventId });
    ctx.updateScore(newScore);
  } catch {
    /* slur add failed */
  }
}

function handleSlurSingleLocations(
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  locations: readonly EventLocation[],
): void {
  if (locations.length === 1) {
    handleSlurSingleLoc(ctx, currentScore, locations[0]!);
    return;
  }
  const newScore = cloneScore(currentScore);
  const shouldRemove = locations.every((location) => {
    const event = getEventAtLocation(newScore, location);
    return event?.type === "event" && !!event.slurs?.length;
  });
  for (const location of locations) {
    const event = getEventAtLocation(newScore, location);
    if (event?.type !== "event") continue;
    if (shouldRemove) {
      delete event.slurs;
      continue;
    }
    const target = findNextEventIdForSlur(newScore, location);
    if (!target) continue;
    event.id ??= generateEventId();
    addSlur(newScore, { sourceEventId: event.id, targetEventId: target });
  }
  ctx.updateScore(newScore);
}

/**
 * Toggle a slur on a single selected grace note, slurring it to the principal
 * note it adorns (the regular event immediately following the grace container).
 * Grace notes live outside the main events vector, so they need their own
 * resolution path rather than `resolveEventLocation`.
 */
function handleSlurGraceLoc(ctx: KeyboardHandlerContext, currentScore: Score, graceLoc: GraceLocation): void {
  const newScore = cloneScore(currentScore);
  const seq = newScore.parts[graceLoc.partIndex]?.measures[graceLoc.measureIndex]?.sequences[graceLoc.sequenceIndex];
  if (!seq) return;
  const containerArr: SequenceContent[] =
    graceLoc.tupletIndex !== undefined
      ? (() => {
          const t = seq.content[graceLoc.tupletIndex];
          return t && t.type === "tuplet" ? t.content : [];
        })()
      : seq.content;
  const container = containerArr[graceLoc.graceContainerIndex];
  if (!container || container.type !== "grace") return;
  const graceEv = container.content[graceLoc.graceNoteIndex];
  if (!graceEv || graceEv.type !== "event") return;

  // Already slurred — toggle off.
  if (graceEv.slurs && graceEv.slurs.length > 0) {
    delete graceEv.slurs;
    ctx.updateScore(newScore);
    return;
  }

  // Slur to the principal note (immediately follows the grace container).
  const principal = containerArr[graceLoc.graceContainerIndex + 1];
  if (!principal || principal.type !== "event" || !principal.notes?.length) return;
  if (!graceEv.id) graceEv.id = generateEventId();
  if (!principal.id) principal.id = generateEventId();
  try {
    addSlur(newScore, { sourceEventId: graceEv.id, targetEventId: principal.id });
    ctx.updateScore(newScore);
  } catch {
    /* slur add failed */
  }
}

/**
 * S key: toggle slur on the selection.
 *
 * A bar (measure) or multi/range selection behaves as if every covered note
 * were selected. Because a slur can't cross staves/voices, the covered notes
 * are grouped by voice and one slur is drawn per voice (first → last covered
 * note in that voice) — so a multi-staff bar selection slurs every staff at
 * once. A selection that covers just one event toggles a slur to the next event.
 */
export function handleSlurKey(e: KeyboardEvent, ctx: KeyboardHandlerContext): void {
  const sel = ctx.getSelection();
  const currentScore = ctx.getScore();
  if (!currentScore) return;

  if (sel.kind === "single") {
    // A grace-note element id (`…/{ev}/grace/{g}`) would otherwise resolve to
    // its principal event via resolveEventLocation (which ignores the trailing
    // /grace/ segment), so check for a grace location first.
    const graceLoc = resolveGraceLocation(sel.elementId, currentScore);
    if (graceLoc) {
      e.preventDefault();
      handleSlurGraceLoc(ctx, currentScore, graceLoc);
      return;
    }
    const loc = resolveEventLocation(sel.elementId, currentScore);
    if (!loc) return;
    e.preventDefault();
    handleSlurSingleLocations(
      ctx,
      currentScore,
      resolveCondensedSelectionEvents(currentScore, sel, ctx.getConfig?.().selectedScoreIndex ?? 0),
    );
    return;
  }

  if (sel.kind === "range" || sel.kind === "multi" || sel.kind === "measure") {
    const events = resolveCondensedSelectionEvents(currentScore, sel, ctx.getConfig?.().selectedScoreIndex ?? 0);
    if (events.length === 0) return;
    e.preventDefault();
    if (events.length === 1) {
      const only = events[0];
      if (only) handleSlurSingleLoc(ctx, currentScore, only);
      return;
    }
    handleSlurSpanGroups(ctx, currentScore, events);
  }
}

/** T key: toggle tie on selected note(s). */
function tieSelectedEvents(currentScore: Score, events: EventLocation[]): Score | null {
  let newScore = cloneScore(currentScore);
  let changed = false;
  for (const group of groupEventsByVoice(events)) {
    for (let index = 0; index < group.length - 1; index++) {
      const source = group[index];
      const selectedTarget = group[index + 1];
      if (!source || !selectedTarget) continue;
      const candidate = cloneScore(newScore);
      if (!addTie(candidate, source)) continue;
      const sourceEvent = getEventAtLocation(candidate, source);
      const targetEvent = getEventAtLocation(candidate, selectedTarget);
      const targetNoteIds = new Set(targetEvent?.type === "event" ? targetEvent.notes?.map((note) => note.id) : []);
      const reachesSelectedTarget =
        sourceEvent?.type === "event" &&
        sourceEvent.notes?.some((note) => note.ties?.some((tie) => targetNoteIds.has(tie.target)));
      if (!reachesSelectedTarget) continue;
      newScore = candidate;
      changed = true;
    }
  }
  return changed ? newScore : null;
}

export function handleTieKey(e: KeyboardEvent, ctx: KeyboardHandlerContext): void {
  const sel = ctx.getSelection();
  const currentScore = ctx.getScore();
  if (!currentScore) return;

  if (sel.kind === "range" || sel.kind === "multi" || sel.kind === "measure") {
    const events = resolveCondensedSelectionEvents(currentScore, sel, ctx.getConfig?.().selectedScoreIndex ?? 0);
    if (events.length < 2) return;
    e.preventDefault();
    const newScore = tieSelectedEvents(currentScore, events);
    if (newScore) ctx.updateScore(newScore);
    return;
  }

  if (sel.kind === "single") {
    const loc = resolveEventLocation(sel.elementId, currentScore);
    if (!loc) return;
    const event = getEventAtLocation(currentScore, loc);
    if (!event || event.type !== "event" || !event.notes || event.notes.length === 0) return;
    e.preventDefault();
    const targets = resolveCondensedSelectionEvents(currentScore, sel, ctx.getConfig?.().selectedScoreIndex ?? 0);
    const hasTies = targets.every((target) => {
      const targetEvent = getEventAtLocation(currentScore, target);
      return targetEvent?.type === "event" && targetEvent.notes?.some((note) => note.ties?.length);
    });
    const newScore = cloneScore(currentScore);
    let changed = false;
    for (const target of targets) {
      const result = hasTies ? removeTies(newScore, target) : addTie(newScore, target);
      changed = result !== null || changed;
    }
    if (changed) ctx.updateScore(newScore);
  }
}

/** Duration key 1-7: change selected note's duration. */
export function handleDurationChange(e: KeyboardEvent, base: string, ctx: KeyboardHandlerContext): void {
  const sel = ctx.getSelection();
  if (sel.kind !== "single") return;
  const currentScore = ctx.getScore();
  if (!currentScore) return;
  const loc = resolveEventLocation(sel.elementId, currentScore);
  if (!loc) return;
  // Changing duration of an event inside a tuplet would require resizing the
  // tuplet's inner sequence — not currently supported. Block to avoid corruption.
  if (loc.tupletIndex !== undefined) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  const newScore = cloneScore(currentScore);
  try {
    changeDuration(newScore, {
      measureIndex: loc.measureIndex,
      partIndex: loc.partIndex,
      voice: loc.sequenceIndex,
      eventIndex: loc.eventIndex,
      newDuration: { base: base as NoteValueBase },
    });
    ctx.updateScore(newScore);
  } catch {
    /* ignore */
  }
}

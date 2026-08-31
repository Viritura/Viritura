import type { Score, NoteEvent, SequenceContent, TupletBracket, TupletDisplaySetting } from "@viritura/core";
import type { NoteValueBase, Octave, StemDirection, Step } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import { resolveEventLocation, resolveEventFromSubElement, resolveGraceLocation } from "../score/ElementPath";
import { setSlurProperties, setTieProperties } from "./noteCommands";

import { applyLayoutOverrides, type LayoutOverrideParams } from "./layoutCommands";
import { produce } from "../score/scoreClone";

export interface NotationSelectionTarget {
  elementId: string;
  elementType: string;
  partIndex: number;
  measureIndex: number;
  sequenceIndex?: number;
  eventIndex?: number;
  /** If the event is inside a tuplet, the index of the tuplet in seq.content. */
  tupletIndex?: number;
  /** If the event is a grace note, the index of its grace container in seq.content. */
  graceContainerIndex?: number;
  /** For tie selections: index of the note in the source event holding the tie. */
  noteIndex?: number;
  /** For tie selections: index into the note's `ties` array. */
  tieIndex?: number;
  /** For slur selections: index into the source event's `slurs` array. */
  slurIndex?: number;
}

interface EditResult {
  ok: boolean;
  score?: Score;
  error?: string;
}

const NOTE_STEPS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

export function resolveNotationSelectionTarget(selection: Selection, score: Score): NotationSelectionTarget | null {
  if (selection.kind !== "single") return null;
  const { elementId } = selection;

  // Spanner IDs use model-ID paths: `slur/{srcEventId}/{tgtEventId}` and
  // `tie/{srcNoteId}/{tgtNoteId|lv}`. Resolve them by locating the source
  // event (slur) or the source note's event (tie) in the score, and record
  // the sub-index of the matching slur/tie so the inspector can edit it.
  if (elementId.startsWith("slur/")) {
    return resolveSlurSelectionTarget(elementId, score);
  }

  if (elementId.startsWith("tie/")) {
    return resolveTieSelectionTarget(elementId, score);
  }

  // A grace-note element id (`…/{ev}/grace/{g}`) would otherwise resolve to its
  // principal event via resolveEventLocation (which ignores the trailing
  // /grace/ segment), so check for a grace location first and target the grace
  // event itself.
  const graceLoc = resolveGraceLocation(elementId, score);
  if (graceLoc && graceLoc.tupletIndex === undefined) {
    return {
      elementId,
      elementType: "event",
      partIndex: graceLoc.partIndex,
      measureIndex: graceLoc.measureIndex,
      sequenceIndex: graceLoc.sequenceIndex,
      eventIndex: graceLoc.graceNoteIndex,
      graceContainerIndex: graceLoc.graceContainerIndex,
    };
  }

  const eventLoc = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
  if (eventLoc) {
    return {
      elementId,
      elementType: "event",
      partIndex: eventLoc.partIndex,
      measureIndex: eventLoc.measureIndex,
      sequenceIndex: eventLoc.sequenceIndex,
      eventIndex: eventLoc.eventIndex,
      tupletIndex: eventLoc.tupletIndex,
      noteIndex: eventLoc.noteIndex,
    };
  }

  const measureMatch = elementId.match(/(?:^|\/)m(\d+)(?:\/|$)/);
  if (!measureMatch) {
    return null;
  }
  const partMatch = elementId.match(/(?:^|\/)p(\d+)(?:\/|$)/);
  const tokens = elementId.split("/");
  const elementType = tokens[tokens.length - 1] ?? "measure";
  return {
    elementId,
    elementType,
    partIndex: partMatch ? Number.parseInt(partMatch[1]!, 10) : 0,
    measureIndex: Number.parseInt(measureMatch[1]!, 10),
  };
}

function resolveSlurSelectionTarget(elementId: string, score: Score): NotationSelectionTarget | null {
  const parts = elementId.split("/");
  const srcEventId = parts[1];
  const tgtEventId = parts[2];
  if (!srcEventId || !tgtEventId) return null;
  const loc = locateEventByModelId(score, srcEventId);
  if (!loc) return null;
  const event = getEventAtLoc(score, loc);
  const slurIndex = event?.slurs?.findIndex((s) => s.target === tgtEventId) ?? -1;
  if (slurIndex < 0) return null;
  return {
    elementId,
    elementType: "slur",
    partIndex: loc.partIndex,
    measureIndex: loc.measureIndex,
    sequenceIndex: loc.sequenceIndex,
    eventIndex: loc.eventIndex,
    tupletIndex: loc.tupletIndex,
    graceContainerIndex: loc.graceContainerIndex,
    slurIndex,
  };
}

function resolveTieSelectionTarget(elementId: string, score: Score): NotationSelectionTarget | null {
  const parts = elementId.split("/");
  const srcNoteId = parts[1];
  const tgtNoteId = parts[2];
  if (!srcNoteId || !tgtNoteId) return null;
  const isLv = tgtNoteId === "lv";
  const loc = locateNoteByModelId(score, srcNoteId);
  if (!loc) return null;
  const event = getEventAtLoc(score, loc);
  const note = event?.notes?.[loc.noteIndex ?? 0];
  const tieIndex = note?.ties?.findIndex((t) => (isLv ? t.lv === true : t.target === tgtNoteId)) ?? -1;
  if (tieIndex < 0) return null;
  return {
    elementId,
    elementType: "tie",
    partIndex: loc.partIndex,
    measureIndex: loc.measureIndex,
    sequenceIndex: loc.sequenceIndex,
    eventIndex: loc.eventIndex,
    tupletIndex: loc.tupletIndex,
    graceContainerIndex: loc.graceContainerIndex,
    noteIndex: loc.noteIndex,
    tieIndex,
  };
}

interface EventLoc {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
  noteIndex?: number;
}

function* iterScoreEvents(score: Score): Generator<{ event: NoteEvent; loc: EventLoc }> {
  for (let p = 0; p < score.parts.length; p++) {
    const part = score.parts[p]!;
    for (let m = 0; m < part.measures.length; m++) {
      const measure = part.measures[m]!;
      for (let s = 0; s < measure.sequences.length; s++) {
        const seq = measure.sequences[s]!;
        yield* iterSequenceEvents(seq.content, p, m, s);
      }
    }
  }
}

function* iterSequenceEvents(
  content: readonly SequenceContent[],
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
): Generator<{ event: NoteEvent; loc: EventLoc }> {
  // Container descent (tuplet/grace/tremolo) lives in the canonical
  // `walkSequenceEvents` primitive; here we only project its general index
  // path onto the legacy per-kind EventLoc fields.
  for (const { event, path } of walkSequenceEvents(content)) {
    yield { event, loc: pathToEventLoc(path, content, partIndex, measureIndex, sequenceIndex) };
  }
}

/**
 * Project a general container index path onto the legacy EventLoc shape.
 * `tupletIndex` covers both tuplet and tremolo containers (they share that
 * field by long-standing convention); grace containers use `graceContainerIndex`.
 */
function pathToEventLoc(
  path: readonly number[],
  content: readonly SequenceContent[],
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
): EventLoc {
  const base = { partIndex, measureIndex, sequenceIndex };
  if (path.length === 1) {
    return { ...base, eventIndex: path[0]! };
  }
  const containerIndex = path[0]!;
  const eventIndex = path[path.length - 1]!;
  const container = content[containerIndex];
  if (container?.type === "grace") {
    return { ...base, eventIndex, graceContainerIndex: containerIndex };
  }
  return { ...base, eventIndex, tupletIndex: containerIndex };
}

function locateEventByModelId(score: Score, eventId: string): EventLoc | null {
  for (const { event, loc } of iterScoreEvents(score)) {
    if (event.id === eventId) return loc;
  }
  return null;
}

function locateNoteByModelId(score: Score, noteId: string): EventLoc | null {
  for (const { event, loc } of iterScoreEvents(score)) {
    if (!event.notes) continue;
    const ni = event.notes.findIndex((n) => n.id === noteId);
    if (ni >= 0) return { ...loc, noteIndex: ni };
  }
  return null;
}

function getEventAtLoc(score: Score, loc: EventLoc): NoteEvent | null {
  const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!seq) return null;
  if (loc.graceContainerIndex !== undefined) {
    const g = seq.content[loc.graceContainerIndex];
    if (!g || g.type !== "grace" || !g.content) return null;
    const ev = g.content[loc.eventIndex];
    return ev?.type === "event" ? ev : null;
  }
  if (loc.tupletIndex !== undefined) {
    const t = seq.content[loc.tupletIndex];
    if (!t || (t.type !== "tuplet" && t.type !== "tremolo") || !t.content) return null;
    const ev = t.content[loc.eventIndex];
    return ev?.type === "event" ? ev : null;
  }
  const ev = seq.content[loc.eventIndex];
  return ev?.type === "event" ? ev : null;
}

export function setMeasureNumber(score: Score, target: NotationSelectionTarget, value: string): EditResult {
  const measure = score.global.measures[target.measureIndex];
  if (!measure) return { ok: false, error: "Selected measure does not exist." };

  const trimmed = value.trim();
  if (trimmed === "") {
    const nextScore = produce(score, (draft) => {
      delete draft.global.measures[target.measureIndex]!.number;
    });
    return { ok: true, score: nextScore };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: "Measure number must be a positive integer." };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 1) {
    return { ok: false, error: "Measure number must be at least 1." };
  }
  const nextScore = produce(score, (draft) => {
    draft.global.measures[target.measureIndex]!.number = parsed;
  });
  return { ok: true, score: nextScore };
}

function _setEventDurationBase(score: Score, target: NotationSelectionTarget, base: NoteValueBase): EditResult {
  if (!getSelectedEvent(score, target)) return { ok: false, error: "Selection is not a note event." };
  const nextScore = produce(score, (draft) => {
    getSelectedEvent(draft, target)!.duration.base = base;
  });
  return { ok: true, score: nextScore };
}

function _setEventDots(score: Score, target: NotationSelectionTarget, value: string): EditResult {
  if (!getSelectedEvent(score, target)) return { ok: false, error: "Selection is not a note event." };

  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "0") {
    const nextScore = produce(score, (draft) => {
      delete getSelectedEvent(draft, target)!.duration.dots;
    });
    return { ok: true, score: nextScore };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: "Dots must be an integer from 0 to 3." };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 0 || parsed > 3) {
    return { ok: false, error: "Dots must be between 0 and 3." };
  }
  const nextScore = produce(score, (draft) => {
    getSelectedEvent(draft, target)!.duration.dots = parsed;
  });
  return { ok: true, score: nextScore };
}

function _setPrimaryNoteStep(score: Score, target: NotationSelectionTarget, value: string): EditResult {
  const event = getSelectedEvent(score, target);
  const note = event?.notes?.[0];
  if (!note) return { ok: false, error: "Selection has no editable note." };

  const upper = value.trim().toUpperCase();
  if (!NOTE_STEPS.has(upper)) {
    return { ok: false, error: "Pitch step must be one of A, B, C, D, E, F, G." };
  }
  const nextScore = produce(score, (draft) => {
    getSelectedEvent(draft, target)!.notes![0]!.pitch.step = upper as Step;
  });
  return { ok: true, score: nextScore };
}

export function setPrimaryNoteAlter(score: Score, target: NotationSelectionTarget, value: string): EditResult {
  const event = getSelectedEvent(score, target);
  const note = event?.notes?.[0];
  if (!note) return { ok: false, error: "Selection has no editable note." };

  const trimmed = value.trim();
  if (trimmed === "") {
    const nextScore = produce(score, (draft) => {
      delete getSelectedEvent(draft, target)!.notes![0]!.pitch.alter;
    });
    return { ok: true, score: nextScore };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, error: "Alter must be an integer from -2 to 2." };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < -2 || parsed > 2) {
    return { ok: false, error: "Alter must be between -2 and 2." };
  }
  const nextScore = produce(score, (draft) => {
    getSelectedEvent(draft, target)!.notes![0]!.pitch.alter = parsed;
  });
  return { ok: true, score: nextScore };
}

function _setPrimaryNoteOctave(score: Score, target: NotationSelectionTarget, value: string): EditResult {
  const event = getSelectedEvent(score, target);
  const note = event?.notes?.[0];
  if (!note) return { ok: false, error: "Selection has no editable note." };

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: "Octave must be an integer from 0 to 9." };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 0 || parsed > 9) {
    return { ok: false, error: "Octave must be between 0 and 9." };
  }
  const nextScore = produce(score, (draft) => {
    getSelectedEvent(draft, target)!.notes![0]!.pitch.octave = parsed as Octave;
  });
  return { ok: true, score: nextScore };
}

export interface TieInspectorPatch {
  target?: string | null;
  targetType?: string | null;
  side?: string | null;
  lv?: boolean | null;
}

export function setPrimaryTieProperties(
  score: Score,
  target: NotationSelectionTarget,
  patch: TieInspectorPatch,
): EditResult {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) {
    return { ok: false, error: "Selection is not a note event." };
  }

  try {
    const nextScore = produce(score, (draft) => {
      setTieProperties(draft, {
        partIndex: target.partIndex,
        measureIndex: target.measureIndex,
        sequenceIndex: target.sequenceIndex!,
        eventIndex: target.eventIndex!,
        tupletIndex: target.tupletIndex,
        graceContainerIndex: target.graceContainerIndex,
        noteIndex: target.noteIndex,
        tieIndex: target.tieIndex,
        ...patch,
      });
    });
    return { ok: true, score: nextScore };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to update tie properties.",
    };
  }
}

export interface SlurInspectorPatch {
  target?: string | null;
  side?: "up" | "down" | null;
  sideEnd?: "up" | "down" | null;
  lineType?: "solid" | "dashed" | "dotted" | null;
  startNote?: string | null;
  endNote?: string | null;
}

export function setPrimarySlurProperties(
  score: Score,
  target: NotationSelectionTarget,
  patch: SlurInspectorPatch,
): EditResult {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) {
    return { ok: false, error: "Selection is not a note event." };
  }

  try {
    const nextScore = produce(score, (draft) => {
      setSlurProperties(draft, {
        partIndex: target.partIndex,
        measureIndex: target.measureIndex,
        sequenceIndex: target.sequenceIndex!,
        eventIndex: target.eventIndex!,
        tupletIndex: target.tupletIndex,
        graceContainerIndex: target.graceContainerIndex,
        slurIndex: target.slurIndex,
        ...patch,
      });
    });
    return { ok: true, score: nextScore };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to update slur properties.",
    };
  }
}

function getSelectedEvent(score: Score, target: NotationSelectionTarget): NoteEvent | null {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) {
    return null;
  }
  const seq = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
  if (!seq) return null;
  let event;
  if (target.tupletIndex !== undefined) {
    const t = seq.content[target.tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    event = t.content[target.eventIndex];
  } else {
    event = seq.content[target.eventIndex];
  }
  return event?.type === "event" ? event : null;
}

// ═══════════════════════════════════════════
// Layout overrides inspector
// ═══════════════════════════════════════════

export interface LayoutOverridesInspectorPatch {
  event?: {
    staff?: number | null;
    stemDirection?: StemDirection | null;
    orient?: "up" | "down" | null;
  };
  sequence?: {
    orient?: "up" | "down" | null;
  };
  tuplet?: {
    orient?: "up" | "down" | null;
    bracket?: TupletBracket | null;
    showNumber?: TupletDisplaySetting | null;
    showValue?: TupletDisplaySetting | null;
  };
}

export function setLayoutOverridesProperties(
  score: Score,
  target: NotationSelectionTarget,
  patch: LayoutOverridesInspectorPatch,
): EditResult {
  if (!target.elementId) {
    return { ok: false, error: "No element selected." };
  }

  const nextScore = applyLayoutOverrides(score, target.elementId, patch as LayoutOverrideParams);
  return { ok: true, score: nextScore };
}

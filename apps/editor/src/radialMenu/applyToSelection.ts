// Pure helpers that apply an articulation, tremolo, or fingering change to
// every event in the current selection. Extracted from App.tsx's
// radial-menu select handler to keep the dispatch switch small.
//
// All selection-shape handling is delegated to `resolveSelectionEvents`, the
// canonical primitive that turns any selection kind (single / multi / range /
// measure) into the de-duplicated, document-ordered list of event locations
// it covers. These helpers only describe what to do *per event*.
import type { Score, ScorePatch, OrnamentType, BreathMarkSymbol } from "@viritura/core";
import { produce } from "immer";
import type { SelectionState } from "../store/selectionStore";
import {
  toggleArticulation,
  setFingerings,
  setSingleTremoloMarks,
  removeMultiNoteTremolo,
  setOrnaments,
  setTrillAccidental,
  setArpeggioMark,
  setBreathMark,
  planToggleArticulation,
  planSetSingleTremoloMarks,
  planSetFingerings,
  type ArticulationType,
  type ArpeggioMarkKind,
} from "../commands/articulationCommands";
import { toggleCourtesyAccidental } from "../commands/noteCommands";
import { getEventAtLocation, type EventLocation } from "../score/ElementPath";
import { applySelectionWriteback, planSelectionWriteback } from "../score/condensedWriteback";

function mutationEvents(score: Score, selection: SelectionState, selectedScoreIndex?: number): EventLocation[] {
  return [...planSelectionWriteback(score, selection, selectedScoreIndex).sourceEvents];
}

/**
 * Run `mutate` against every event the selection covers, returning the new
 * score (or `null` when the selection is empty / the mutation was a no-op).
 */
function applyToSelectedEvents(
  score: Score,
  selection: SelectionState,
  mutate: (draft: Score, loc: EventLocation) => void,
  selectedScoreIndex?: number,
): Score | null {
  return applySelectionWriteback(score, selection, mutate, selectedScoreIndex);
}

/** Note-bearing events the selection covers (rests can't hold articulations). */
function selectedNoteEvents(score: Score, selection: SelectionState, selectedScoreIndex?: number): EventLocation[] {
  return mutationEvents(score, selection, selectedScoreIndex).filter((loc) => {
    const ev = getEventAtLocation(score, loc);
    return ev?.type === "event" && !!ev.notes && ev.notes.length > 0;
  });
}

/**
 * "Match" semantics for a multi-event articulation toggle: if every covered
 * note already carries `articulationType`, the target is OFF (clear all);
 * otherwise — none or a mixed on/off set — the target is ON (add to all).
 *
 * This mirrors mainstream notation editors: a mixed selection first unifies
 * to "on", and only a second press clears it, instead of independently
 * inverting each note (which would leave the mix scrambled). For a single
 * event this reduces to a plain toggle.
 */
function articulationTargetOn(
  score: Score,
  noteEvents: readonly EventLocation[],
  articulationType: ArticulationType,
): boolean {
  const allPresent = noteEvents.every((loc) => {
    const ev = getEventAtLocation(score, loc);
    return ev?.type === "event" && ev.markings?.[articulationType] !== undefined;
  });
  return !allPresent;
}

/**
 * Set `articulationType` to a uniform target state across every event covered
 * by the current selection (single / multi / range / measure), using "match"
 * semantics (see {@link articulationTargetOn}). Returns `null` when the
 * selection covers no note-bearing events.
 */
export function applyArticulationToSelection(
  score: Score,
  selection: SelectionState,
  articulationType: ArticulationType,
  selectedScoreIndex?: number,
): Score | null {
  const noteEvents = selectedNoteEvents(score, selection, selectedScoreIndex);
  if (noteEvents.length === 0) return null;
  const targetOn = articulationTargetOn(score, noteEvents, articulationType);
  const newScore = produce(score, (draft) => {
    for (const loc of noteEvents) {
      const ev = getEventAtLocation(draft, loc);
      if (ev?.type !== "event") continue;
      const present = ev.markings?.[articulationType] !== undefined;
      if (present === targetOn) continue;
      toggleArticulation(
        draft,
        loc.partIndex,
        loc.measureIndex,
        loc.sequenceIndex,
        loc.eventIndex,
        articulationType,
        loc.tupletIndex,
      );
    }
  });
  return newScore !== score ? newScore : null;
}

/**
 * Apply a single-tremolo `marks` count to every event covered by the
 * current selection (single / multi / range / measure). Returns `null`
 * when the selection is unresolvable or empty.
 */
export function applyTremoloToSelection(
  score: Score,
  selection: SelectionState,
  marks: 1 | 2 | 3 | undefined,
  selectedScoreIndex?: number,
): Score | null {
  return applyToSelectedEvents(
    score,
    selection,
    (draft, loc) => {
      setSingleTremoloMarks(
        draft,
        loc.partIndex,
        loc.measureIndex,
        loc.sequenceIndex,
        loc.eventIndex,
        marks,
        loc.tupletIndex,
      );
    },
    selectedScoreIndex,
  );
}

export function removeTremolosFromSelection(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex?: number,
): Score | null {
  const events = mutationEvents(score, selection, selectedScoreIndex);
  if (events.length === 0) return null;

  const containers = new Map<string, EventLocation>();
  const singleEvents: EventLocation[] = [];
  for (const loc of events) {
    const container =
      loc.tupletIndex === undefined
        ? undefined
        : score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content[
            loc.tupletIndex
          ];
    if (container?.type === "tremolo") {
      containers.set(`${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}/${loc.tupletIndex}`, loc);
    } else {
      const event = getEventAtLocation(score, loc);
      if (event?.type === "event" && event.markings?.tremolo !== undefined) singleEvents.push(loc);
    }
  }
  if (containers.size === 0 && singleEvents.length === 0) return null;

  const orderedContainers = [...containers.values()].sort((a, b) => {
    if (a.partIndex !== b.partIndex) return b.partIndex - a.partIndex;
    if (a.measureIndex !== b.measureIndex) return b.measureIndex - a.measureIndex;
    if (a.sequenceIndex !== b.sequenceIndex) return b.sequenceIndex - a.sequenceIndex;
    return b.tupletIndex! - a.tupletIndex!;
  });
  return produce(score, (draft) => {
    for (const loc of singleEvents) {
      setSingleTremoloMarks(
        draft,
        loc.partIndex,
        loc.measureIndex,
        loc.sequenceIndex,
        loc.eventIndex,
        undefined,
        loc.tupletIndex,
      );
    }
    for (const loc of orderedContainers) {
      removeMultiNoteTremolo(draft, loc.partIndex, loc.measureIndex, loc.sequenceIndex, loc.tupletIndex!);
    }
  });
}

/** Compute the fingering list after toggling `finger` on `existing`. */
function toggledFingers(existing: readonly { finger: number }[], finger: number): number[] {
  const hasFinger = existing.some((f) => f.finger === finger);
  return hasFinger
    ? existing.filter((f) => f.finger !== finger).map((f) => f.finger)
    : [...existing.map((f) => f.finger), finger];
}

/** Does every covered note already carry `finger` in its fingering list? */
function allHaveFinger(score: Score, noteEvents: readonly EventLocation[], finger: number): boolean {
  return noteEvents.every((loc) => {
    const ev = getEventAtLocation(score, loc);
    return ev?.type === "event" && (ev.markings?.fingerings ?? []).some((f) => f.finger === finger);
  });
}

/**
 * Add or remove a fingering number uniformly across the selection using the
 * same "match" semantics as articulations: if every covered note already
 * carries `finger`, it is removed from all; otherwise (none or mixed) it is
 * added to all (other fingerings on each note are preserved). Returns `null`
 * when the selection covers no note-bearing events.
 */
export function applyFingeringToSelection(
  score: Score,
  selection: SelectionState,
  finger: number,
  selectedScoreIndex?: number,
): Score | null {
  const noteEvents = selectedNoteEvents(score, selection, selectedScoreIndex);
  if (noteEvents.length === 0) return null;
  const targetOn = !allHaveFinger(score, noteEvents, finger);
  const newScore = produce(score, (draft) => {
    for (const loc of noteEvents) {
      const ev = getEventAtLocation(draft, loc);
      if (ev?.type !== "event") continue;
      const existing = ev.markings?.fingerings ?? [];
      const present = existing.some((f) => f.finger === finger);
      if (present === targetOn) continue;
      const next = toggledFingers(existing, finger);
      setFingerings(draft, loc.partIndex, loc.measureIndex, loc.sequenceIndex, loc.eventIndex, next, loc.tupletIndex);
    }
  });
  return newScore !== score ? newScore : null;
}

/** Does every covered note already carry `ornament` in its ornament list? */
function allHaveOrnament(score: Score, noteEvents: readonly EventLocation[], ornament: OrnamentType): boolean {
  return noteEvents.every((loc) => {
    const ev = getEventAtLocation(score, loc);
    return ev?.type === "event" && (ev.markings?.ornaments ?? []).includes(ornament);
  });
}

/**
 * Add or remove an ornament uniformly across the selection using "match"
 * semantics: if every covered note already carries `ornament`, it is removed
 * from all; otherwise (none or mixed) it is added to all (other ornaments on
 * each note are preserved). Returns `null` when the selection covers no
 * note-bearing events.
 */
export function applyOrnamentToSelection(
  score: Score,
  selection: SelectionState,
  ornament: OrnamentType,
  selectedScoreIndex?: number,
): Score | null {
  const noteEvents = selectedNoteEvents(score, selection, selectedScoreIndex);
  if (noteEvents.length === 0) return null;
  const targetOn = !allHaveOrnament(score, noteEvents, ornament);
  const newScore = produce(score, (draft) => {
    for (const loc of noteEvents) {
      const ev = getEventAtLocation(draft, loc);
      if (ev?.type !== "event") continue;
      const existing = ev.markings?.ornaments ?? [];
      const present = existing.includes(ornament);
      if (present === targetOn) continue;
      const next = present ? existing.filter((o) => o !== ornament) : [...existing, ornament];
      setOrnaments(
        draft,
        loc.partIndex,
        loc.measureIndex,
        loc.sequenceIndex,
        loc.eventIndex,
        next.length > 0 ? next : undefined,
        loc.tupletIndex,
      );
    }
  });
  return newScore !== score ? newScore : null;
}

/** Does every covered note already carry a trill? */
function allHaveTrill(score: Score, noteEvents: readonly EventLocation[]): boolean {
  return noteEvents.every((loc) => {
    const ev = getEventAtLocation(score, loc);
    return ev?.type === "event" && ev.markings?.trill !== undefined;
  });
}

/**
 * Toggle a trill uniformly across the selection using "match" semantics: if
 * every covered note already has a trill, it is removed from all; otherwise
 * (none or mixed) a trill is added to all. Notes that already carry a trill
 * keep their accidental untouched when the target is ON. Returns `null` when
 * the selection covers no note-bearing events.
 */
export function applyTrillToSelection(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex?: number,
): Score | null {
  const noteEvents = selectedNoteEvents(score, selection, selectedScoreIndex);
  if (noteEvents.length === 0) return null;
  const targetOn = !allHaveTrill(score, noteEvents);
  const newScore = produce(score, (draft) => {
    for (const loc of noteEvents) {
      const ev = getEventAtLocation(draft, loc);
      if (ev?.type !== "event") continue;
      const present = ev.markings?.trill !== undefined;
      if (present === targetOn) continue;
      setTrillAccidental(
        draft,
        loc.partIndex,
        loc.measureIndex,
        loc.sequenceIndex,
        loc.eventIndex,
        targetOn ? null : undefined,
        loc.tupletIndex,
      );
    }
  });
  return newScore !== score ? newScore : null;
}

export function applyArpeggioToSelection(
  score: Score,
  selection: SelectionState,
  kind: ArpeggioMarkKind,
  selectedScoreIndex?: number,
): Score | null {
  return applyToSelectedEvents(
    score,
    selection,
    (draft, loc) => {
      setArpeggioMark(draft, loc.partIndex, loc.measureIndex, loc.sequenceIndex, loc.eventIndex, kind, loc.tupletIndex);
    },
    selectedScoreIndex,
  );
}

export function applyCourtesyAccidentalToSelection(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex?: number,
): Score | null {
  return applyToSelectedEvents(
    score,
    selection,
    (draft, loc) => {
      toggleCourtesyAccidental(draft, {
        partIndex: loc.partIndex,
        measureIndex: loc.measureIndex,
        sequenceIndex: loc.sequenceIndex,
        eventIndex: loc.eventIndex,
        tupletIndex: loc.tupletIndex,
      });
    },
    selectedScoreIndex,
  );
}

export function applyBreathMarkToSelection(
  score: Score,
  selection: SelectionState,
  symbol: BreathMarkSymbol | undefined,
  selectedScoreIndex?: number,
): Score | null {
  return applyToSelectedEvents(
    score,
    selection,
    (draft, loc) => {
      setBreathMark(draft, loc.partIndex, loc.measureIndex, loc.sequenceIndex, loc.eventIndex, symbol, loc.tupletIndex);
    },
    selectedScoreIndex,
  );
}

// ═══════════════════════════════════════════
// Patch-IR (fast-path) siblings
//
// These return `ScorePatch[]` for dispatch through `commitPatches`, which
// routes through the schema-aware Y.Doc adapter on live sessions instead
// of the schema-blind full-tree walk. They return `null` when the
// selection (or any event in it) lacks a plan-form patch — caller falls
// back to the mutate-form sibling above.
// ═══════════════════════════════════════════

type SelectionVisit = (loc: EventLocation) => ScorePatch[] | null;

/**
 * Accumulate the patches each `visit` call returns across every event the
 * selection covers. Returns `null` the first time a visit call returns null
 * (one unresolvable event collapses the whole batch back to the slow path —
 * keeps the fast/slow choice all-or-nothing per command), or when the
 * selection is empty.
 */
function collectPatchesForSelection(
  score: Score,
  selection: SelectionState,
  visit: SelectionVisit,
  selectedScoreIndex?: number,
): ScorePatch[] | null {
  const events = mutationEvents(score, selection, selectedScoreIndex);
  if (events.length === 0) return null;
  const patches: ScorePatch[] = [];
  for (const loc of events) {
    const result = visit(loc);
    if (!result) return null;
    patches.push(...result);
  }
  return patches;
}

/** Patch-IR sibling of {@link applyArticulationToSelection}. */
export function planArticulationForSelection(
  score: Score,
  selection: SelectionState,
  articulationType: ArticulationType,
  selectedScoreIndex?: number,
): ScorePatch[] | null {
  const noteEvents = selectedNoteEvents(score, selection, selectedScoreIndex);
  if (noteEvents.length === 0) return null;
  const targetOn = articulationTargetOn(score, noteEvents, articulationType);
  const patches: ScorePatch[] = [];
  for (const loc of noteEvents) {
    const ev = getEventAtLocation(score, loc);
    const present = ev?.type === "event" && ev.markings?.[articulationType] !== undefined;
    if (present === targetOn) continue;
    // State differs from the target, so a plain toggle moves it the right way.
    const result = planToggleArticulation(
      score,
      loc.partIndex,
      loc.measureIndex,
      loc.sequenceIndex,
      loc.eventIndex,
      articulationType,
      loc.tupletIndex,
    );
    if (!result) return null;
    patches.push(...result);
  }
  return patches.length > 0 ? patches : null;
}

/** Patch-IR sibling of {@link applyTremoloToSelection}. */
export function planTremoloForSelection(
  score: Score,
  selection: SelectionState,
  marks: 1 | 2 | 3,
  selectedScoreIndex?: number,
): ScorePatch[] | null {
  return collectPatchesForSelection(
    score,
    selection,
    (loc) =>
      planSetSingleTremoloMarks(
        score,
        loc.partIndex,
        loc.measureIndex,
        loc.sequenceIndex,
        loc.eventIndex,
        marks,
        loc.tupletIndex,
      ),
    selectedScoreIndex,
  );
}

/**
 * Patch-IR sibling of {@link applyFingeringToSelection}. Uses the same "match"
 * semantics so the fast path and slow path agree.
 */
export function planFingeringForSelection(
  score: Score,
  selection: SelectionState,
  finger: number,
  selectedScoreIndex?: number,
): ScorePatch[] | null {
  const noteEvents = selectedNoteEvents(score, selection, selectedScoreIndex);
  if (noteEvents.length === 0) return null;
  const targetOn = !allHaveFinger(score, noteEvents, finger);
  const patches: ScorePatch[] = [];
  for (const loc of noteEvents) {
    const ev = getEventAtLocation(score, loc);
    if (ev?.type !== "event") return null;
    const existing = ev.markings?.fingerings ?? [];
    const present = existing.some((f) => f.finger === finger);
    if (present === targetOn) continue;
    const next = toggledFingers(existing, finger);
    const result = planSetFingerings(
      score,
      loc.partIndex,
      loc.measureIndex,
      loc.sequenceIndex,
      loc.eventIndex,
      next,
      loc.tupletIndex,
    );
    if (!result) return null;
    patches.push(...result);
  }
  return patches.length > 0 ? patches : null;
}

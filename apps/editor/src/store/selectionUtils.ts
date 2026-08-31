import type { Score, SequenceContent } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import {
  buildNavigationIndex,
  findEntryIndex,
  findFirst,
  findLast,
  type NavigationEntry,
} from "../navigation/NavigationIndex";
import {
  eventSuffix,
  graceId,
  resolveEventLocation,
  resolveEventFromSubElement,
  getEventAncestorId,
  type EventLocation,
} from "../score/ElementPath";
import { isMeasureLevel } from "../score/elementTypes";
import type { Selection } from "./selectionStore";

/**
 * Measure-index range derived from element-ID-based selection.
 */
export interface MeasureRange {
  startMeasure: number;
  endMeasure: number;
  startPart: number;
  endPart: number;
  startVoice: number;
  endVoice: number;
}

/**
 * Convert an element-ID range selection into measure indices.
 * Ensures startMeasure <= endMeasure regardless of element order.
 * Handles sub-element IDs (e.g. noteheads) via resolveEventFromSubElement.
 */
export function resolveSelectionMeasureRange(
  startElementId: string,
  endElementId: string,
  score: Score,
): MeasureRange | null {
  const startLoc = resolveEventFromSubElement(startElementId, score) ?? resolveEventLocation(startElementId, score);
  const endLoc = resolveEventFromSubElement(endElementId, score) ?? resolveEventLocation(endElementId, score);
  if (!startLoc || !endLoc) return null;

  const minMeasure = Math.min(startLoc.measureIndex, endLoc.measureIndex);
  const maxMeasure = Math.max(startLoc.measureIndex, endLoc.measureIndex);
  const minPart = Math.min(startLoc.partIndex, endLoc.partIndex);
  const maxPart = Math.max(startLoc.partIndex, endLoc.partIndex);
  const minVoice = Math.min(startLoc.sequenceIndex, endLoc.sequenceIndex);
  const maxVoice = Math.max(startLoc.sequenceIndex, endLoc.sequenceIndex);

  return {
    startMeasure: minMeasure,
    endMeasure: maxMeasure,
    startPart: minPart,
    endPart: maxPart,
    startVoice: minVoice,
    endVoice: maxVoice,
  };
}

function appendMeasureLevelRangeEntries(
  entries: readonly NavigationEntry[],
  selectedIds: string[],
  partIndex: number,
  earlierEntry: NavigationEntry,
  laterEntry: NavigationEntry,
): void {
  for (const entry of entries) {
    if (!isMeasureLevel(entry.elementType) || entry.partIndex !== partIndex) continue;
    const afterStart =
      entry.measureIndex > earlierEntry.measureIndex ||
      (entry.measureIndex === earlierEntry.measureIndex && entry.sortKey >= earlierEntry.sortKey - 1e-9);
    const beforeEnd =
      entry.measureIndex < laterEntry.measureIndex ||
      (entry.measureIndex === laterEntry.measureIndex && entry.sortKey <= laterEntry.sortKey + 1e-9);
    if (afterStart && beforeEnd) selectedIds.push(entry.elementId);
  }
}

function resolveSamePartRangeEventIds(
  entries: readonly NavigationEntry[],
  partIndex: number,
  earlierEntry: NavigationEntry,
  laterEntry: NavigationEntry,
): string[] {
  return entries
    .filter((entry) => {
      if (entry.elementType !== "event" && entry.elementType !== "rest") return false;
      if (entry.partIndex !== partIndex) return false;
      if (entry.measureIndex < earlierEntry.measureIndex || entry.measureIndex > laterEntry.measureIndex) return false;
      if (entry.measureIndex === earlierEntry.measureIndex && entry.sortKey < earlierEntry.sortKey - 1e-9) return false;
      if (entry.measureIndex === laterEntry.measureIndex && entry.sortKey > laterEntry.sortKey + 1e-9) return false;
      return true;
    })
    .map((entry) => entry.elementId);
}

/**
 * Get all element IDs that fall within the range of a selection.
 * Used for visual highlighting and clipboard operations.
 *
 * For same-part selections: uses navigation index slice for precise event matching.
 * For cross-part selections: uses measure range to include all events across staves.
 */
// eslint-disable-next-line complexity, max-statements -- range resolution keeps note, voice, staff, and direction boundaries together
export function resolveRangeElementIds(startElementId: string, endElementId: string, score: Score): string[] {
  const navIndex = buildNavigationIndex(score);
  const isRangeSelectable = (entry: (typeof navIndex.entries)[number]): boolean =>
    entry.elementType === "event" || entry.elementType === "rest" || isMeasureLevel(entry.elementType);

  // Strip sub-element suffixes (e.g. /n0, /art0) to match event-level nav entries
  const startAncestor = getEventAncestorId(startElementId);
  const endAncestor = getEventAncestorId(endElementId);

  const startIdx =
    findEntryIndex(navIndex, startAncestor) !== -1
      ? findEntryIndex(navIndex, startAncestor)
      : findEntryIndex(navIndex, startElementId);
  const endIdx =
    findEntryIndex(navIndex, endAncestor) !== -1
      ? findEntryIndex(navIndex, endAncestor)
      : findEntryIndex(navIndex, endElementId);

  if (startIdx !== -1 && endIdx !== -1) {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const loEntry = navIndex.entries[lo]!;
    const hiEntry = navIndex.entries[hi]!;

    const samePart = loEntry.partIndex === hiEntry.partIndex;

    if (samePart) {
      const earlierEntry =
        loEntry.measureIndex < hiEntry.measureIndex ||
        (loEntry.measureIndex === hiEntry.measureIndex && loEntry.sortKey <= hiEntry.sortKey)
          ? loEntry
          : hiEntry;
      const laterEntry = earlierEntry === loEntry ? hiEntry : loEntry;

      // Same-part: use navigation index slice with voice filtering
      const sameSeq = loEntry.sequenceIndex === hiEntry.sequenceIndex && loEntry.sequenceIndex >= 0;
      if (sameSeq) {
        // Same voice: events use the contiguous slice, while measure-level
        // annotations use their temporal position because they are indexed
        // after all events in the measure.
        const selected = navIndex.entries
          .slice(lo, hi + 1)
          .filter((e) => {
            if (e.elementType !== "event" && e.elementType !== "rest") return false;
            if (e.partIndex !== loEntry.partIndex) return false;
            if (e.sequenceIndex !== loEntry.sequenceIndex) return false;
            return true;
          })
          .map((e) => e.elementId);
        appendMeasureLevelRangeEntries(navIndex.entries, selected, loEntry.partIndex, earlierEntry, laterEntry);
        return selected;
      }
      // Same part, different voice: use beat-position filtering
      const selected = resolveSamePartRangeEventIds(navIndex.entries, loEntry.partIndex, earlierEntry, laterEntry);
      appendMeasureLevelRangeEntries(navIndex.entries, selected, loEntry.partIndex, earlierEntry, laterEntry);
      return selected;
    }

    // Cross-part: beat-position-aware rectangular selection.
    // At boundary measures, only include events whose start beat falls
    // within the selection endpoints — so a half-note starting before the
    // click point on another staff is excluded.
    const minPart = Math.min(loEntry.partIndex, hiEntry.partIndex);
    const maxPart = Math.max(loEntry.partIndex, hiEntry.partIndex);
    const minMeasure = Math.min(loEntry.measureIndex, hiEntry.measureIndex);
    const maxMeasure = Math.max(loEntry.measureIndex, hiEntry.measureIndex);

    // Determine the beat boundaries from the actual start/end entries.
    // The "earlier" element in time sets the start beat; the "later" sets end beat.
    let startBeat: number;
    let endBeat: number;
    let startMeasure: number;
    let endMeasure: number;
    if (
      loEntry.measureIndex < hiEntry.measureIndex ||
      (loEntry.measureIndex === hiEntry.measureIndex && loEntry.sortKey <= hiEntry.sortKey)
    ) {
      startBeat = loEntry.sortKey;
      endBeat = hiEntry.sortKey;
      startMeasure = loEntry.measureIndex;
      endMeasure = hiEntry.measureIndex;
    } else {
      startBeat = hiEntry.sortKey;
      endBeat = loEntry.sortKey;
      startMeasure = hiEntry.measureIndex;
      endMeasure = loEntry.measureIndex;
    }

    const selected = navIndex.entries
      .filter((e) => {
        if (e.elementType !== "event" && e.elementType !== "rest") return false;
        if (e.partIndex < minPart || e.partIndex > maxPart) return false;
        if (e.measureIndex < minMeasure || e.measureIndex > maxMeasure) return false;

        // At the start measure boundary: exclude events that start before the selection
        if (e.measureIndex === startMeasure && e.sortKey < startBeat - 1e-9) return false;
        // At the end measure boundary: exclude events that start after the selection
        if (e.measureIndex === endMeasure && e.sortKey > endBeat + 1e-9) return false;

        return true;
      })
      .map((e) => e.elementId);
    for (const entry of navIndex.entries) {
      if (!isMeasureLevel(entry.elementType)) continue;
      if (entry.partIndex < minPart || entry.partIndex > maxPart) continue;
      if (entry.measureIndex < minMeasure || entry.measureIndex > maxMeasure) continue;
      if (entry.measureIndex === startMeasure && entry.sortKey < startBeat - 1e-9) continue;
      if (entry.measureIndex === endMeasure && entry.sortKey > endBeat + 1e-9) continue;
      selected.push(entry.elementId);
    }
    return selected;
  }

  // Fallback to measure-level range if element IDs aren't in the nav index
  const range = resolveSelectionMeasureRange(startElementId, endElementId, score);
  if (!range) return [];

  return navIndex.entries
    .filter((entry) => {
      if (!isRangeSelectable(entry)) return false;
      if (entry.partIndex < range.startPart || entry.partIndex > range.endPart) return false;
      if (entry.measureIndex < range.startMeasure || entry.measureIndex > range.endMeasure) return false;
      return true;
    })
    .map((entry) => entry.elementId);
}

/** Grace-note IDs attached to ordinary events covered by an element range. */
export function resolveRangeGraceElementIds(startElementId: string, endElementId: string, score: Score): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const parentId of resolveRangeElementIds(startElementId, endElementId, score)) {
    const parent = resolveEventLocation(parentId, score);
    if (!parent) continue;
    const sequence = score.parts[parent.partIndex]?.measures[parent.measureIndex]?.sequences[parent.sequenceIndex];
    const tuplet = parent.tupletIndex === undefined ? undefined : sequence?.content[parent.tupletIndex];
    const content =
      parent.tupletIndex === undefined ? sequence?.content : tuplet?.type === "tuplet" ? tuplet.content : undefined;
    const parentSuffix = parentId.split("/")[3];
    if (!parentSuffix) continue;
    const candidateIndices = [parent.eventIndex - 1];
    if (parent.eventIndex + 1 === (content?.length ?? 0) - 1) candidateIndices.push(parent.eventIndex + 1);
    for (const containerIndex of candidateIndices) {
      const grace = content?.[containerIndex];
      if (grace?.type !== "grace") continue;
      for (let index = 0; index < grace.content.length; index++) {
        const event = grace.content[index];
        if (!event) continue;
        const locationKey = `${parent.partIndex}/${parent.measureIndex}/${parent.sequenceIndex}/${parent.tupletIndex ?? -1}/${containerIndex}/${index}`;
        if (seen.has(locationKey)) continue;
        seen.add(locationKey);
        ids.push(
          graceId(
            parent.partIndex,
            parent.measureIndex,
            parent.sequenceIndex,
            parentSuffix,
            eventSuffix(event.id, index),
          ),
        );
      }
    }
  }
  return ids;
}

/**
 * Get element IDs for selecting the entire score (Ctrl+A).
 * Returns first and last element IDs.
 */
export function selectAllRange(score: Score): { startElementId: string; endElementId: string } | null {
  const navIndex = buildNavigationIndex(score);
  const first = findFirst(navIndex);
  const last = findLast(navIndex);
  if (!first || !last) return null;
  if (first === last) return null; // Only one element — use single selection
  return { startElementId: first, endElementId: last };
}

/**
 * Extend selection from current element to end of score.
 */
export function selectToEnd(currentElementId: string, score: Score): string | null {
  const navIndex = buildNavigationIndex(score);
  const last = findLast(navIndex);
  if (!last || last === currentElementId) return null;
  return last;
}

/**
 * Extend selection from current element to start of score.
 */
export function selectToStart(currentElementId: string, score: Score): string | null {
  const navIndex = buildNavigationIndex(score);
  const first = findFirst(navIndex);
  if (!first || first === currentElementId) return null;
  return first;
}

// ═══════════════════════════════════════════════════════════════════════
// Canonical selection resolution
//
// `resolveSelection` is the single primitive every action should use to turn
// a `Selection` (the one true union from selectionStore) into concrete
// targets. It replaces the hand-rolled four-arm `selection.kind === ...`
// ladders that were duplicated across the radial menu, clipboard, delete,
// transpose, and command layers — each with subtly different dedup, ordering,
// and sub-element handling. Centralizing here makes per-action behavior
// consistent across single / multi / range / measure selections.
// ═══════════════════════════════════════════════════════════════════════

/** Stable identity key for an event location (ignores noteIndex — event-level). */
function eventKey(loc: EventLocation): string {
  return `${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}/${loc.tupletIndex ?? -1}/${loc.eventIndex}`;
}

/** Content-tree path used to compare top-level and container-nested events. */
function eventContentPath(loc: EventLocation): number[] {
  return loc.tupletIndex === undefined ? [loc.eventIndex] : [loc.tupletIndex, loc.eventIndex];
}

/** Compare two event locations in document order. */
function compareEventLocations(a: EventLocation, b: EventLocation): number {
  if (a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;
  if (a.measureIndex !== b.measureIndex) return a.measureIndex - b.measureIndex;
  if (a.sequenceIndex !== b.sequenceIndex) return a.sequenceIndex - b.sequenceIndex;
  const aPath = eventContentPath(a);
  const bPath = eventContentPath(b);
  const sharedLength = Math.min(aPath.length, bPath.length);
  for (let index = 0; index < sharedLength; index++) {
    if (aPath[index] !== bPath[index]) return aPath[index]! - bPath[index]!;
  }
  return aPath.length - bPath.length;
}

/** Resolve an element ID to an event location, preserving tuplet nesting. */
function resolveAnyEvent(elementId: string, score: Score): EventLocation | null {
  return resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
}

/** Push every event in one sequence (descending into tuplet/tremolo) into `out`. */
function pushSequenceEvents(
  out: EventLocation[],
  content: SequenceContent[],
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
): void {
  // Container descent lives in the canonical walkSequenceEvents primitive.
  // EventLocation can address a top-level event or a single tuplet/tremolo
  // container child (via tupletIndex). Grace events have no EventLocation
  // representation, and nested-tuplet depth (>1) isn't addressable either, so
  // both are intentionally left out of the event-mode target list.
  for (const { path } of walkSequenceEvents(content)) {
    if (path.length === 1) {
      out.push({ partIndex, measureIndex, sequenceIndex, eventIndex: path[0]! });
      continue;
    }
    if (path.length === 2) {
      const container = content[path[0]!];
      if (container?.type === "tuplet" || container?.type === "tremolo") {
        out.push({ partIndex, measureIndex, sequenceIndex, eventIndex: path[1]!, tupletIndex: path[0]! });
      }
    }
  }
}

/**
 * Enumerate every event location inside a measure rectangle (inclusive on all
 * bounds), descending into tuplets. Used for measure-kind selections.
 */
function enumerateMeasureRangeEvents(
  score: Score,
  startPart: number,
  endPart: number,
  startMeasure: number,
  endMeasure: number,
): EventLocation[] {
  const out: EventLocation[] = [];
  const lastPart = Math.min(endPart, score.parts.length - 1);
  for (let p = startPart; p <= lastPart; p++) {
    const part = score.parts[p];
    if (!part) continue;
    const lastMeasure = Math.min(endMeasure, part.measures.length - 1);
    for (let m = startMeasure; m <= lastMeasure; m++) {
      const measure = part.measures[m];
      if (!measure) continue;
      for (let s = 0; s < measure.sequences.length; s++) {
        const seq = measure.sequences[s];
        if (seq) pushSequenceEvents(out, seq.content, p, m, s);
      }
    }
  }
  return out;
}

/**
 * Resolve the current selection into the distinct list of note/rest event
 * locations it covers, in document order. This is the canonical input for
 * every "event-mode" action (articulations, tremolo, fingering, transpose,
 * note deletion, …).
 *
 * - `none` → `[]`
 * - `single` → the one event (sub-element IDs like noteheads resolve to their
 *   parent event)
 * - `multi` → each element's event, de-duplicated (two noteheads of the same
 *   chord collapse to a single event so event-level toggles don't cancel out)
 * - `range` → every event between the endpoints (beat-aware, cross-staff)
 * - `measure` → every event inside the measure/part rectangle
 *
 * `noteIndex` is intentionally dropped — the result is an event-level list.
 */
export function resolveSelectionEvents(selection: Selection, score: Score): EventLocation[] {
  const raw: EventLocation[] = [];
  switch (selection.kind) {
    case "none":
      return [];
    case "single": {
      const loc = resolveAnyEvent(selection.elementId, score);
      if (loc) raw.push(loc);
      break;
    }
    case "multi": {
      for (const id of selection.elementIds) {
        const loc = resolveAnyEvent(id, score);
        if (loc) raw.push(loc);
      }
      break;
    }
    case "range": {
      const ids = resolveRangeElementIds(selection.startElementId, selection.endElementId, score);
      for (const id of ids) {
        const loc = resolveAnyEvent(id, score);
        if (loc) raw.push(loc);
      }
      break;
    }
    case "measure": {
      const startP = Math.min(selection.startPartIndex, selection.endPartIndex);
      const endP = Math.max(selection.startPartIndex, selection.endPartIndex);
      const startM = Math.min(selection.startMeasure, selection.endMeasure);
      const endM = Math.max(selection.startMeasure, selection.endMeasure);
      raw.push(...enumerateMeasureRangeEvents(score, startP, endP, startM, endM));
      break;
    }
  }

  // De-duplicate by event identity (dropping noteIndex) and sort to document order.
  const seen = new Set<string>();
  const unique: EventLocation[] = [];
  for (const loc of raw) {
    const key = eventKey(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      partIndex: loc.partIndex,
      measureIndex: loc.measureIndex,
      sequenceIndex: loc.sequenceIndex,
      eventIndex: loc.eventIndex,
      ...(loc.tupletIndex !== undefined && { tupletIndex: loc.tupletIndex }),
    });
  }
  unique.sort(compareEventLocations);
  return unique;
}

/**
 * A note-level selection target: an event plus which of its notes are covered.
 * `notes === "all"` means the whole event/chord; otherwise it's the specific
 * notehead indices the selection picked out.
 */
export interface NoteSelectionTarget {
  loc: EventLocation;
  notes: number[] | "all";
}

/**
 * Resolve the selection into note-level targets, in document order. Unlike
 * `resolveSelectionEvents` (which collapses every chord to a single event),
 * this preserves notehead granularity so per-note actions (accidentals) only
 * touch the notes the user actually selected:
 *
 * - a bare event / whole-chord selection → `notes: "all"`
 * - individual noteheads (`…/n2`) → just those indices, merged per chord
 * - `range` / `measure` → every covered event with `notes: "all"`
 *
 * If a chord is covered both as a whole event and via specific noteheads, the
 * whole-event ("all") wins.
 */
export function resolveSelectionNotes(selection: Selection, score: Score): NoteSelectionTarget[] {
  const groups = new Map<string, { loc: EventLocation; notes: Set<number> | "all" }>();

  const stripNoteIndex = (loc: EventLocation): EventLocation => ({
    partIndex: loc.partIndex,
    measureIndex: loc.measureIndex,
    sequenceIndex: loc.sequenceIndex,
    eventIndex: loc.eventIndex,
    ...(loc.tupletIndex !== undefined && { tupletIndex: loc.tupletIndex }),
  });

  const add = (loc: EventLocation, forceAll: boolean) => {
    const key = eventKey(loc);
    const existing = groups.get(key);
    if (forceAll || loc.noteIndex === undefined) {
      groups.set(key, { loc: stripNoteIndex(loc), notes: "all" });
      return;
    }
    if (!existing) {
      groups.set(key, { loc: stripNoteIndex(loc), notes: new Set([loc.noteIndex]) });
    } else if (existing.notes !== "all") {
      existing.notes.add(loc.noteIndex);
    }
  };

  switch (selection.kind) {
    case "none":
      return [];
    case "single": {
      const loc = resolveAnyEvent(selection.elementId, score);
      if (loc) add(loc, false);
      break;
    }
    case "multi": {
      for (const id of selection.elementIds) {
        const loc = resolveAnyEvent(id, score);
        if (loc) add(loc, false);
      }
      break;
    }
    case "range": {
      const ids = resolveRangeElementIds(selection.startElementId, selection.endElementId, score);
      for (const id of ids) {
        const loc = resolveAnyEvent(id, score);
        if (loc) add(loc, true);
      }
      break;
    }
    case "measure": {
      const startP = Math.min(selection.startPartIndex, selection.endPartIndex);
      const endP = Math.max(selection.startPartIndex, selection.endPartIndex);
      const startM = Math.min(selection.startMeasure, selection.endMeasure);
      const endM = Math.max(selection.startMeasure, selection.endMeasure);
      for (const loc of enumerateMeasureRangeEvents(score, startP, endP, startM, endM)) add(loc, true);
      break;
    }
  }

  const targets = [...groups.values()].map((g) => ({
    loc: g.loc,
    notes: g.notes === "all" ? ("all" as const) : [...g.notes].sort((a, b) => a - b),
  }));
  targets.sort((a, b) => compareEventLocations(a.loc, b.loc));
  return targets;
}

/**
 * Group event locations by voice (part + sequence), preserving document order
 * within each group and ordering the groups by their first event.
 *
 * Span-style actions (slurs) connect a first event to a last event *within a
 * single voice* — a slur can't reach across staves or voices. When a selection
 * covers several staves (e.g. a multi-staff bar selection), the right behavior
 * is "apply to all at once": one slur per voice spanning that voice's covered
 * notes. This helper is the seam that turns the flat covered-event list into
 * those per-voice spans.
 */
export function groupEventsByVoice(events: readonly EventLocation[]): EventLocation[][] {
  const groups = new Map<string, EventLocation[]>();
  for (const loc of events) {
    const key = `${loc.partIndex}/${loc.sequenceIndex}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(loc);
    else groups.set(key, [loc]);
  }
  return [...groups.values()];
}

/**
 * The measure/part rectangle a selection touches, for "scope-mode" actions
 * (clef / key / time signatures, measure operations). Derived uniformly for
 * every selection kind so these actions behave consistently:
 *
 * - `measure` → the selected rectangle
 * - `range` → the measure span between the endpoints
 * - `single` → the 1×1 rectangle at the element
 * - `multi` → the bounding rectangle of all elements
 * - `none` → `null`
 */
export function resolveSelectionScope(selection: Selection, score: Score): MeasureRange | null {
  switch (selection.kind) {
    case "none":
      return null;
    case "measure":
      return {
        startMeasure: Math.min(selection.startMeasure, selection.endMeasure),
        endMeasure: Math.max(selection.startMeasure, selection.endMeasure),
        startPart: Math.min(selection.startPartIndex, selection.endPartIndex),
        endPart: Math.max(selection.startPartIndex, selection.endPartIndex),
        startVoice: 0,
        endVoice: 0,
      };
    case "range":
      return resolveSelectionMeasureRange(selection.startElementId, selection.endElementId, score);
    case "single": {
      const loc = resolveAnyEvent(selection.elementId, score);
      if (!loc) return null;
      return {
        startMeasure: loc.measureIndex,
        endMeasure: loc.measureIndex,
        startPart: loc.partIndex,
        endPart: loc.partIndex,
        startVoice: loc.sequenceIndex,
        endVoice: loc.sequenceIndex,
      };
    }
    case "multi": {
      const locs = selection.elementIds
        .map((id) => resolveAnyEvent(id, score))
        .filter((l): l is EventLocation => l !== null);
      if (locs.length === 0) return null;
      return {
        startMeasure: Math.min(...locs.map((l) => l.measureIndex)),
        endMeasure: Math.max(...locs.map((l) => l.measureIndex)),
        startPart: Math.min(...locs.map((l) => l.partIndex)),
        endPart: Math.max(...locs.map((l) => l.partIndex)),
        startVoice: Math.min(...locs.map((l) => l.sequenceIndex)),
        endVoice: Math.max(...locs.map((l) => l.sequenceIndex)),
      };
    }
  }
}

/** The primary element ID for "anchor-mode" (single-target) actions, or null. */
export function resolveSelectionAnchor(selection: Selection): string | null {
  switch (selection.kind) {
    case "single":
      return selection.elementId;
    case "range":
      return selection.startElementId;
    case "multi":
      return selection.elementIds[0] ?? null;
    case "measure":
    case "none":
      return null;
  }
}

/**
 * A selection resolved into every shape an action might need. Bundles the
 * three targeting modes so consumers pick the one their action declares
 * (see `selectionCapabilities`) instead of re-deriving from `selection.kind`.
 */
export interface ResolvedSelection {
  readonly kind: Selection["kind"];
  /** Distinct event locations covered, document order. Empty for non-event selections. */
  readonly events: readonly EventLocation[];
  /** Element IDs covered (for highlight / clipboard). */
  readonly elementIds: readonly string[];
  /** Primary element for single-target actions, or null. */
  readonly anchor: string | null;
  /** Measure/part rectangle the selection touches, or null. */
  readonly scope: MeasureRange | null;
}

/** Every element ID a selection covers (for highlighting and clipboard). */
function resolveSelectionElementIds(selection: Selection, score: Score): string[] {
  switch (selection.kind) {
    case "none":
      return [];
    case "single":
      return [selection.elementId];
    case "multi":
      return [...selection.elementIds];
    case "range":
      return resolveRangeElementIds(selection.startElementId, selection.endElementId, score);
    case "measure":
      // Measure selections are highlighted with the full-bar rectangle overlay,
      // not per-element IDs, so there are no individual element IDs to report.
      return [];
  }
}

/**
 * Resolve a selection into all targeting shapes at once. Prefer the focused
 * `resolveSelectionEvents` / `resolveSelectionScope` helpers when only one
 * shape is needed; use this when an action consumes several.
 */
export function resolveSelection(selection: Selection, score: Score): ResolvedSelection {
  return {
    kind: selection.kind,
    events: resolveSelectionEvents(selection, score),
    elementIds: resolveSelectionElementIds(selection, score),
    anchor: resolveSelectionAnchor(selection),
    scope: resolveSelectionScope(selection, score),
  };
}

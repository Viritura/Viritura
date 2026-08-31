/**
 * Annotation navigation — find and navigate between annotations
 * attached to events and measures.
 *
 * Annotations are non-event elements like fermatas, dynamics, trills, etc.
 * They have synthetic element IDs derived from their parent context:
 *
 * Event-attached (above staff):
 *   {eventId}/fermata, {eventId}/trill, {eventId}/orn{i}
 *
 * Event-attached (below or positional):
 *   {eventId}/breath, {eventId}/arp, {eventId}/fing{i}
 *
 * Measure-level (from PartMeasure):
 *   p{part}/m{measure}/dyn{i}, p{part}/m{measure}/hairpin{i},
 *   p{part}/m{measure}/pedal{i}, p{part}/m{measure}/expr{i},
 *   p{part}/m{measure}/chord{i}
 *
 * Global-level (from GlobalMeasure):
 *   m{measure}/tempo{i}, m{measure}/rehearsal, m{measure}/jump,
 *   m{measure}/coda, m{measure}/caesura
 */

import type { Score, Markings, PartMeasure, GlobalMeasure } from "@viritura/core";
import {
  extractPartIndex,
  extractMeasureIndex,
  getEventAncestorId,
  resolveEventLocation,
  getNoteEventAtLocation,
  articulationId,
  dynamicId,
  hairpinId,
  pedalId,
  expressionId,
  chordSymbolId,
  tempoId,
  rehearsalId,
  jumpId,
  codaId,
  eventId as buildEventId,
  eventSuffix,
} from "../score/ElementPath";
import { articulationNamesInMarkings } from "../score/articulationNames";
import { parseElementType, isEventAttached, isMeasureLevel, isGlobalLevel } from "../score/elementTypes";

/** Position relative to the staff. */
export type AnnotationPosition = "above" | "below";

/** An annotation discovered on an event or in its measure. */
export interface AnnotationInfo {
  /** Synthetic element ID for this annotation */
  elementId: string;
  /** Human-readable type label */
  type: string;
  /** Whether this annotation renders above or below the staff */
  position: AnnotationPosition;
  /** The parent event ID this annotation is associated with */
  parentEventId: string;
}

// ═══════════════════════════════════════════
// Element ID parsing
// ═══════════════════════════════════════════

/**
 * Check if an element ID represents an annotation rather than an event.
 * Annotations have suffixes like /fermata, /trill, /dyn0, /tempo0, etc.
 */
export function isAnnotationId(elementId: string): boolean {
  const type = parseElementType(elementId);
  if (type === "event" || type === "unknown" || type === "note") return false;
  return isEventAttached(type) || isMeasureLevel(type) || isGlobalLevel(type);
}

/** Strip trailing digits from an annotation type: "dyn0" → "dyn", "orn2" → "orn". */
function normalizeAnnotationType(suffix: string): string {
  if (suffix.startsWith("hairpin")) return "hairpin";
  if (suffix.startsWith("dyn")) return "dyn";
  // Articulations are named rather than numbered (`art-accent.staccato`), so
  // the trailing-digit strip below doesn't reach their identifier.
  if (suffix.startsWith("art-")) return "art";
  return suffix.replace(/\d+$/, "");
}

/**
 * Get the parent event ID from an annotation element ID.
 * For event-attached annotations: strips suffixes back to the event.
 * For measure-level annotations: returns undefined (no direct parent event).
 */
export function getParentEventId(annotationId: string): string | undefined {
  const elType = parseElementType(annotationId);
  if (!isEventAttached(elType)) return undefined;
  return getEventAncestorId(annotationId);
}

// ═══════════════════════════════════════════
// Annotation classification
// ═══════════════════════════════════════════

/** Classify whether an annotation type renders above or below the staff. */
export function classifyAnnotationPosition(type: string): AnnotationPosition {
  const normalized = normalizeAnnotationType(type);
  if (BELOW_STAFF_TYPES.has(normalized)) return "below";
  return "above";
}

/** Types that render below the staff. */
const BELOW_STAFF_TYPES = new Set(["dyn", "hairpin", "pedal", "expr"]);

// ═══════════════════════════════════════════
// Finding annotations
// ═══════════════════════════════════════════

/**
 * Find all annotations attached to or near the given event.
 * Includes event-level markings and measure-level directions.
 */
export function findAnnotationsForEvent(score: Score, eventId: string): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];

  // Parse event location from ID
  const loc = resolveEventLocation(eventId, score);
  if (!loc) return annotations;

  const { partIndex, measureIndex } = loc;
  const event = getNoteEventAtLocation(score, loc);

  // 1. Event-attached markings (from event.markings)
  if (event?.markings) {
    annotations.push(...extractMarkingAnnotations(event.markings, eventId));
  }
  // Native MNX fermata (event-level since v15).
  if (event?.fermata) {
    annotations.push({
      elementId: `${eventId}/fermata`,
      type: "fermata",
      position: "above",
      parentEventId: eventId,
    });
  }

  // 2. Measure-level part annotations (dynamics, hairpins, pedals, expressions, chord symbols)
  const partMeasure = score.parts[partIndex]?.measures[measureIndex];
  if (partMeasure) {
    annotations.push(...extractPartMeasureAnnotations(partMeasure, partIndex, measureIndex, eventId));
  }

  // 3. Global measure annotations (tempos, rehearsal marks, jumps, etc.)
  const globalMeasure = score.global.measures[measureIndex];
  if (globalMeasure) {
    annotations.push(...extractGlobalAnnotations(globalMeasure, measureIndex, eventId));
  }

  return annotations;
}

/** Extract annotations from event markings. */
function extractMarkingAnnotations(markings: Markings, eventId: string): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];

  if (markings.trill) {
    annotations.push({
      elementId: `${eventId}/trill`,
      type: "trill",
      position: "above",
      parentEventId: eventId,
    });
  }

  if (markings.ornaments && markings.ornaments.length > 0) {
    for (let i = 0; i < markings.ornaments.length; i++) {
      annotations.push({
        elementId: `${eventId}/orn${i}`,
        type: "ornament",
        position: "above",
        parentEventId: eventId,
      });
    }
  }

  if (markings.breath) {
    annotations.push({
      elementId: `${eventId}/breath`,
      type: "breath",
      position: "above",
      parentEventId: eventId,
    });
  }

  if (markings.arpeggio) {
    annotations.push({
      elementId: `${eventId}/arp`,
      type: "arpeggio",
      position: "above",
      parentEventId: eventId,
    });
  }

  if (markings.tremolo) {
    annotations.push({
      elementId: `${eventId}/trem`,
      type: "tremolo",
      position: "above",
      parentEventId: eventId,
    });
  }

  if (markings.fingerings && markings.fingerings.length > 0) {
    for (let i = 0; i < markings.fingerings.length; i++) {
      annotations.push({
        elementId: `${eventId}/fing${i}`,
        type: "fingering",
        position: "above",
        parentEventId: eventId,
      });
    }
  }

  // Articulations (staccato, accent, tenuto, …). Names come from the shared
  // collector so navigation targets the ids the engine actually emits —
  // including combo ligatures, which are one glyph and so one target.
  for (const name of articulationNamesInMarkings(markings)) {
    annotations.push({
      elementId: articulationId(eventId, name),
      type: "articulation",
      position: "above",
      parentEventId: eventId,
    });
  }

  return annotations;
}

/** Extract annotations from the part measure (dynamics, hairpins, etc.). */
function extractPartMeasureAnnotations(
  partMeasure: PartMeasure,
  partIndex: number,
  measureIndex: number,
  parentEventId: string,
): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];

  if (partMeasure.dynamics) {
    for (const dynamic of partMeasure.dynamics) {
      const gradual = dynamic.type === "gradual";
      annotations.push({
        elementId: gradual
          ? hairpinId(partIndex, measureIndex, dynamic.id)
          : dynamicId(partIndex, measureIndex, dynamic.id),
        type: gradual ? "hairpin" : "dynamic",
        position: "below",
        parentEventId,
      });
    }
  }

  if (partMeasure.pedals) {
    for (let i = 0; i < partMeasure.pedals.length; i++) {
      annotations.push({
        elementId: pedalId(partIndex, measureIndex, i),
        type: "pedal",
        position: "below",
        parentEventId,
      });
    }
  }

  if (partMeasure.expressions) {
    for (let i = 0; i < partMeasure.expressions.length; i++) {
      annotations.push({
        elementId: expressionId(partIndex, measureIndex, i),
        type: "expression",
        position: "below",
        parentEventId,
      });
    }
  }

  if (partMeasure.chordSymbols) {
    for (let i = 0; i < partMeasure.chordSymbols.length; i++) {
      annotations.push({
        elementId: chordSymbolId(partIndex, measureIndex, i),
        type: "chord-symbol",
        position: "above",
        parentEventId,
      });
    }
  }

  return annotations;
}

/** Extract annotations from the global measure (tempos, rehearsals, etc.). */
function extractGlobalAnnotations(
  globalMeasure: GlobalMeasure,
  measureIndex: number,
  parentEventId: string,
): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];

  if (globalMeasure.tempos) {
    for (let i = 0; i < globalMeasure.tempos.length; i++) {
      annotations.push({
        elementId: tempoId(measureIndex, i),
        type: "tempo",
        position: "above",
        parentEventId,
      });
    }
  }

  if (globalMeasure.rehearsalMark) {
    annotations.push({
      elementId: rehearsalId(measureIndex),
      type: "rehearsal",
      position: "above",
      parentEventId,
    });
  }

  if (globalMeasure.jump) {
    annotations.push({
      elementId: jumpId(measureIndex),
      type: "jump",
      position: "above",
      parentEventId,
    });
  }

  if (globalMeasure.coda) {
    annotations.push({
      elementId: codaId(measureIndex),
      type: "coda",
      position: "above",
      parentEventId,
    });
  }

  return annotations;
}

// ═══════════════════════════════════════════
// Navigation helpers
// ═══════════════════════════════════════════

/**
 * Find the first annotation above the staff for the given event.
 * Returns undefined if no above-staff annotations exist.
 */
export function findAnnotationAbove(score: Score, eventId: string): string | undefined {
  const annotations = findAnnotationsForEvent(score, eventId);
  const above = annotations.filter((a) => a.position === "above");
  return above[0]?.elementId;
}

/**
 * Find the first annotation below the staff for the given event.
 * Returns undefined if no below-staff annotations exist.
 */
export function findAnnotationBelow(score: Score, eventId: string): string | undefined {
  const annotations = findAnnotationsForEvent(score, eventId);
  const below = annotations.filter((a) => a.position === "below");
  return below[0]?.elementId;
}

/**
 * From a currently selected annotation, find the next annotation of the
 * same type. Wraps around.
 */
export function findNextAnnotation(score: Score, annotationId: string): string | undefined {
  const parentId = getParentEventId(annotationId);
  if (!parentId) {
    // Measure-level annotation — find siblings of same type
    return findNextMeasureAnnotation(score, annotationId);
  }

  const annotations = findAnnotationsForEvent(score, parentId);
  const currentType = getAnnotationType(annotationId);
  const sameType = annotations.filter((a) => a.type === currentType);

  const idx = sameType.findIndex((a) => a.elementId === annotationId);
  if (idx < 0 || sameType.length <= 1) return undefined;
  return sameType[(idx + 1) % sameType.length]!.elementId;
}

/**
 * From a currently selected annotation, find the previous annotation of the
 * same type. Wraps around.
 */
export function findPrevAnnotation(score: Score, annotationId: string): string | undefined {
  const parentId = getParentEventId(annotationId);
  if (!parentId) {
    return findPrevMeasureAnnotation(score, annotationId);
  }

  const annotations = findAnnotationsForEvent(score, parentId);
  const currentType = getAnnotationType(annotationId);
  const sameType = annotations.filter((a) => a.type === currentType);

  const idx = sameType.findIndex((a) => a.elementId === annotationId);
  if (idx < 0 || sameType.length <= 1) return undefined;
  return sameType[(idx - 1 + sameType.length) % sameType.length]!.elementId;
}

/**
 * From a currently selected annotation, find the first annotation on the
 * opposite side of the staff (above ↔ below).
 */
export function findAnnotationOtherSide(score: Score, annotationId: string): string | undefined {
  const parentId = getParentEventId(annotationId);
  if (!parentId) {
    // Measure-level annotation — determine position and find opposite side
    return findMeasureAnnotationOtherSide(score, annotationId);
  }

  const annotations = findAnnotationsForEvent(score, parentId);
  const currentAnno = annotations.find((a) => a.elementId === annotationId);
  if (!currentAnno) return undefined;

  const targetPosition: AnnotationPosition = currentAnno.position === "above" ? "below" : "above";
  const otherSide = annotations.filter((a) => a.position === targetPosition);
  return otherSide[0]?.elementId;
}

// ═══════════════════════════════════════════
// Measure-level annotation navigation
// ═══════════════════════════════════════════

/** Find the next measure-level annotation of the same type. */
function findNextMeasureAnnotation(score: Score, annotationId: string): string | undefined {
  const measureIdx = extractMeasureIndex(annotationId);
  const partIdx = extractPartIndex(annotationId);
  if (measureIdx === undefined) return undefined;

  const type = getAnnotationType(annotationId);
  const siblings = getMeasureLevelAnnotations(score, measureIdx, partIdx, type);
  const idx = siblings.findIndex((id) => id === annotationId);
  if (idx < 0 || siblings.length <= 1) return undefined;
  return siblings[(idx + 1) % siblings.length];
}

/** Find the previous measure-level annotation of the same type. */
function findPrevMeasureAnnotation(score: Score, annotationId: string): string | undefined {
  const measureIdx = extractMeasureIndex(annotationId);
  const partIdx = extractPartIndex(annotationId);
  if (measureIdx === undefined) return undefined;

  const type = getAnnotationType(annotationId);
  const siblings = getMeasureLevelAnnotations(score, measureIdx, partIdx, type);
  const idx = siblings.findIndex((id) => id === annotationId);
  if (idx < 0 || siblings.length <= 1) return undefined;
  return siblings[(idx - 1 + siblings.length) % siblings.length];
}

/** Find the annotation on the other side for a measure-level annotation. */
function findMeasureAnnotationOtherSide(score: Score, annotationId: string): string | undefined {
  const measureIdx = extractMeasureIndex(annotationId);
  const partIdx = extractPartIndex(annotationId);
  if (measureIdx === undefined) return undefined;

  const currentPosition = classifyAnnotationPosition(getAnnotationType(annotationId));
  const targetPosition: AnnotationPosition = currentPosition === "above" ? "below" : "above";

  // Find the first event in this measure to use as context
  const eventId = findFirstEventInMeasure(score, measureIdx, partIdx ?? 0);
  if (!eventId) return undefined;

  const annotations = findAnnotationsForEvent(score, eventId);
  const otherSide = annotations.filter((a) => a.position === targetPosition);
  return otherSide[0]?.elementId;
}

type PartLevelKind = "pedal" | "expression" | "chord-symbol";

interface PartLevelEntry {
  field: keyof PartMeasure;
  id: (p: number, m: number, i: number) => string;
}

const PART_LEVEL_MAP: Record<PartLevelKind, PartLevelEntry> = {
  pedal: { field: "pedals", id: pedalId },
  expression: { field: "expressions", id: expressionId },
  "chord-symbol": { field: "chordSymbols", id: chordSymbolId },
};

function pushPartLevelIds(ids: string[], pm: PartMeasure, partIndex: number, measureIndex: number, type: string): void {
  if (type === "hairpin") {
    for (const group of pm.dynamics ?? []) {
      if (group.type === "gradual") ids.push(hairpinId(partIndex, measureIndex, group.id));
    }
    return;
  }
  if (type === "dynamic") {
    for (const group of pm.dynamics ?? []) {
      if (group.type !== "gradual") ids.push(dynamicId(partIndex, measureIndex, group.id));
    }
    return;
  }
  const entry = PART_LEVEL_MAP[type as PartLevelKind];
  if (!entry) return;
  const arr = pm[entry.field] as unknown[] | undefined;
  if (!arr) return;
  for (let i = 0; i < arr.length; i++) {
    ids.push(entry.id(partIndex, measureIndex, i));
  }
}

function pushGlobalLevelIds(ids: string[], gm: GlobalMeasure, measureIndex: number, type: string): void {
  if (type === "tempo" && gm.tempos) {
    for (let i = 0; i < gm.tempos.length; i++) ids.push(tempoId(measureIndex, i));
  } else if (type === "rehearsal" && gm.rehearsalMark) {
    ids.push(rehearsalId(measureIndex));
  } else if (type === "jump" && gm.jump) {
    ids.push(jumpId(measureIndex));
  } else if (type === "coda" && gm.coda) {
    ids.push(codaId(measureIndex));
  }
}

/** Get all measure-level annotation IDs of a given type. */
function getMeasureLevelAnnotations(
  score: Score,
  measureIndex: number,
  partIndex: number | undefined,
  type: string,
): string[] {
  const ids: string[] = [];

  if (partIndex !== undefined) {
    const pm = score.parts[partIndex]?.measures[measureIndex];
    if (pm) pushPartLevelIds(ids, pm, partIndex, measureIndex, type);
  }

  const gm = score.global.measures[measureIndex];
  if (gm) pushGlobalLevelIds(ids, gm, measureIndex, type);

  return ids;
}

// ═══════════════════════════════════════════
// Utility helpers
// ═══════════════════════════════════════════

/** Map from annotation ID suffix to type label used in AnnotationInfo. */
function getAnnotationType(annotationId: string): string {
  const parts = annotationId.split("/");
  const last = parts[parts.length - 1] ?? "";
  const normalized = normalizeAnnotationType(last);

  const TYPE_MAP: Record<string, string> = {
    fermata: "fermata",
    trill: "trill",
    orn: "ornament",
    art: "articulation",
    breath: "breath",
    arp: "arpeggio",
    trem: "tremolo",
    fing: "fingering",
    dyn: "dynamic",
    hairpin: "hairpin",
    pedal: "pedal",
    expr: "expression",
    chord: "chord-symbol",
    tempo: "tempo",
    rehearsal: "rehearsal",
    jump: "jump",
    coda: "coda",
  };

  return TYPE_MAP[normalized] ?? normalized;
}

/** Find the first event element ID in a given measure. */
function findFirstEventInMeasure(score: Score, measureIndex: number, partIndex: number): string | undefined {
  const part = score.parts[partIndex];
  if (!part) return undefined;
  const measure = part.measures[measureIndex];
  if (!measure) return undefined;

  for (let s = 0; s < measure.sequences.length; s++) {
    const seq = measure.sequences[s];
    if (!seq) continue;
    for (let e = 0; e < seq.content.length; e++) {
      const ev = seq.content[e];
      if (!ev || ev.type !== "event") continue;
      const evSuffix = eventSuffix(ev.id, e, measureIndex, s);
      return buildEventId(partIndex, measureIndex, s, evSuffix);
    }
  }

  return undefined;
}

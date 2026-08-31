import type {
  Score,
  NoteEvent,
  Markings,
  RhythmicPosition,
  BreathMarkSymbol,
  CaesuraStyle,
  FermataSymbol,
  OrnamentType,
  ArpeggioDirection,
  MultiNoteTremolo,
  SequenceContent,
  ScorePatch,
  EventLocator,
  MeasurePath,
} from "@viritura/core";
import { createDynamicGroup, dynamicSpelling, patch, type AuthoredDynamicValue } from "@viritura/core";
import { durationToBeats, generateNoteId, sequenceContentBeats } from "./noteCommands";
import { dynamicStaffAtLocation } from "./dynamicStaff";

// ═══════════════════════════════════════════
// Articulation types
// ═══════════════════════════════════════════

/** Supported articulation kinds that map to Markings fields. */
export type ArticulationType =
  | "staccato"
  | "staccatissimo"
  | "staccatissimoWedge"
  | "spiccato"
  | "accent"
  | "tenuto"
  | "strongAccent"
  | "softAccent"
  | "stress"
  | "unstress";

// ═══════════════════════════════════════════
// Toggle articulation on a selected event
// ═══════════════════════════════════════════

/**
 * Toggle an articulation marking on the event at the given location.
 * If the articulation is already present, it is removed; otherwise it is added.
 * Returns the mutated score, or null if the location is invalid or event is a rest.
 */
export function toggleArticulation(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  articulation: ArticulationType,
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !ev.notes || ev.notes.length === 0) return null;

  if (!ev.markings) {
    ev.markings = {};
  }

  // Toggle: if present, remove; if absent, add
  if (ev.markings[articulation]) {
    delete ev.markings[articulation];
    // Clean up empty markings object
    if (Object.keys(ev.markings).length === 0) {
      delete ev.markings;
    }
  } else {
    if (articulation === "accent") {
      ev.markings.accent = {};
    } else if (articulation === "strongAccent") {
      ev.markings.strongAccent = {};
    } else {
      ev.markings[articulation] = {};
    }
  }

  return score;
}

// ═══════════════════════════════════════════
// Event marking setters
// ═══════════════════════════════════════════

export function setBreathMark(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  symbol?: BreathMarkSymbol,
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev) return null;
  updateMarkings(ev, (markings) => {
    if (symbol === undefined) {
      delete markings.breath;
      return;
    }
    markings.breath = symbol === "comma" ? {} : { symbol };
  });
  return score;
}

export function setCaesura(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  style?: CaesuraStyle,
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev) return null;
  updateMarkings(ev, (markings) => {
    if (style === undefined) {
      delete markings.caesura;
      return;
    }
    markings.caesura = style === "normal" ? {} : { style };
  });
  return score;
}

export function setSingleTremoloMarks(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  marks?: 1 | 2 | 3,
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  updateMarkings(ev, (markings) => {
    if (marks === undefined) {
      delete markings.tremolo;
      return;
    }
    markings.tremolo = { marks };
  });
  return score;
}

/**
 * Create or toggle a two-note (fingered) tremolo from two selected adjacent events.
 * Requires exactly two adjacent events (eventIndex1 and eventIndex2 must differ by 1).
 * If the first item is already a MultiNoteTremolo with the same marks, it is unwrapped.
 * If it's a MultiNoteTremolo with different marks, the marks are updated.
 * Otherwise wraps the two events into a MultiNoteTremolo.
 */
export function setMultiNoteTremolo(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex1: number,
  eventIndex2: number,
  marks: 1 | 2 | 3,
): Score | null {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex];
  if (!seq) return null;
  const content = seq.content;

  // Normalize order
  const first = Math.min(eventIndex1, eventIndex2);
  const second = Math.max(eventIndex1, eventIndex2);

  // Must be exactly adjacent
  if (second - first !== 1) return null;

  const item = content[first];
  if (!item) return null;

  // Toggle off / update existing multi-note tremolo
  if (item.type === "tremolo") {
    const trem = item as MultiNoteTremolo;
    if (trem.marks === marks) {
      removeMultiNoteTremolo(score, partIndex, measureIndex, seqIndex, first);
    } else {
      // Different marks → update
      trem.marks = marks;
    }
    return score;
  }

  // Create new multi-note tremolo from two adjacent events
  if (item.type !== "event") return null;
  const ev1 = item as NoteEvent;
  if (!hasPlayableNotes(ev1)) return null;

  const next = content[second];
  if (!next || next.type !== "event") return null;
  const ev2 = next as NoteEvent;
  if (!hasPlayableNotes(ev2)) return null;

  // Both events must have the same duration
  if (ev1.duration.base !== ev2.duration.base || (ev1.duration.dots ?? 0) !== (ev2.duration.dots ?? 0)) return null;

  const displayedDuration = doubledWrittenDuration(ev1.duration);
  if (!displayedDuration) return null;
  const individualDuration = { ...ev1.duration };

  const tremolo: MultiNoteTremolo = {
    type: "tremolo",
    content: [
      { ...ev1, duration: displayedDuration },
      { ...ev2, duration: { ...displayedDuration } },
    ],
    marks,
    outer: { duration: individualDuration, multiple: 2 },
    individualDuration,
  };
  content.splice(first, 2, tremolo);
  return score;
}

export function removeMultiNoteTremolo(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  containerIndex: number,
): Score | null {
  const content = score.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex]?.content;
  const item = content?.[containerIndex];
  if (!content || item?.type !== "tremolo") return null;

  const restored = item.content.map(
    (event): NoteEvent => ({
      ...event,
      duration: item.individualDuration ? { ...item.individualDuration } : { ...event.duration },
    }),
  );
  content.splice(containerIndex, 1, ...restored);
  return score;
}

export function setMultiNoteTremoloMarks(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  containerIndex: number,
  marks: 1 | 2 | 3,
): Score | null {
  const item = score.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex]?.content[containerIndex];
  if (item?.type !== "tremolo") return null;
  item.marks = marks;
  return score;
}

function doubledWrittenDuration(duration: NoteEvent["duration"]): NoteEvent["duration"] | null {
  const bases = [
    "duplexMaxima",
    "maxima",
    "longa",
    "breve",
    "whole",
    "half",
    "quarter",
    "eighth",
    "16th",
    "32nd",
    "64th",
    "128th",
    "256th",
    "512th",
    "1024th",
    "2048th",
    "4096th",
  ] as const;
  const index = bases.indexOf(duration.base);
  if (index <= 0) return null;
  return { base: bases[index - 1]!, ...(duration.dots ? { dots: duration.dots } : {}) };
}

export function setFermataShape(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  symbol?: FermataSymbol,
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev) return null;
  if (symbol === undefined) {
    delete ev.fermata;
  } else {
    ev.fermata = symbol === "normal" ? {} : { symbol };
  }
  return score;
}

export function setTrillAccidental(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  accidental?: -1 | 0 | 1 | null,
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  updateMarkings(ev, (markings) => {
    if (accidental === undefined) {
      delete markings.trill;
      return;
    }
    markings.trill = accidental === null ? {} : { accidental };
  });
  return score;
}

export function setOrnaments(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  ornaments?: OrnamentType[],
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  const normalized = ornaments?.filter((orn): orn is OrnamentType => orn.length > 0) ?? [];
  updateMarkings(ev, (markings) => {
    if (normalized.length === 0) {
      delete markings.ornaments;
      return;
    }
    markings.ornaments = normalized;
  });
  return score;
}

export function setArpeggioDirection(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  direction?: ArpeggioDirection | null,
  tupletIndex?: number,
): Score | null {
  const kind = direction === undefined ? undefined : direction === null ? "plain" : direction;
  return setArpeggioMark(score, partIndex, measureIndex, seqIndex, eventIndex, kind, tupletIndex);
}

export type ArpeggioMarkKind = ArpeggioDirection | "plain" | "nonArpeggio";

export function setArpeggioMark(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  kind?: ArpeggioMarkKind,
  tupletIndex?: number,
): Score | null {
  const partMeasure = score.parts[partIndex]?.measures[measureIndex];
  const seq = partMeasure?.sequences[seqIndex];
  if (!partMeasure || !seq) return null;

  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev) return null;
  if (kind !== undefined && (!ev.notes || ev.notes.length < 2)) return null;

  const position = computeEventPosition(seq.content as SequenceContent[], eventIndex, tupletIndex);
  if (!position) return null;

  const firstNote = ev.notes?.[0];
  const lastNote = ev.notes?.[ev.notes.length - 1];
  const span = firstNote && lastNote ? ensureIdSpan(firstNote, lastNote) : undefined;

  clearArpeggioObjectsAt(partMeasure, position, span);
  if (kind === undefined) return score;
  if (!span) return null;

  if (kind === "nonArpeggio") {
    partMeasure.nonArpeggios = [...(partMeasure.nonArpeggios ?? []), { position, span }];
  } else {
    partMeasure.arpeggios = [
      ...(partMeasure.arpeggios ?? []),
      {
        position,
        span,
        direction: kind === "plain" ? "auto" : kind,
        arrow: kind !== "plain",
      },
    ];
  }
  return score;
}

export function setFingerings(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  fingers?: readonly number[],
  tupletIndex?: number,
): Score | null {
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  const sanitized = (fingers ?? []).map((finger) => Math.trunc(finger)).filter((finger) => finger >= 0 && finger <= 5);
  updateMarkings(ev, (markings) => {
    if (sanitized.length === 0) {
      delete markings.fingerings;
      return;
    }
    markings.fingerings = sanitized.map((finger) => ({ finger }));
  });
  return score;
}

// ═══════════════════════════════════════════
// Add / remove dynamic at a position
// ═══════════════════════════════════════════

/** Supported dynamic values. */
export type DynamicValue = AuthoredDynamicValue;

/**
 * Add or toggle a dynamic marking at the position of the given event.
 * If the same dynamic already exists at the position, it is removed.
 * If a different dynamic exists, it is replaced.
 */
export function toggleDynamic(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  value: DynamicValue,
  tupletIndex?: number,
): Score | null {
  const partMeasure = score.parts[partIndex]?.measures[measureIndex];
  if (!partMeasure) return null;

  const seq = partMeasure.sequences[seqIndex];
  if (!seq) return null;

  // Compute the rhythmic position of the event
  const position = computeEventPosition(seq.content, eventIndex, tupletIndex);
  if (!position) return null;
  const voice = partMeasure.sequences.length > 1 ? (seq.voice ?? `v${seqIndex + 1}`) : undefined;
  const staff = dynamicStaffAtLocation(score, {
    partIndex,
    measureIndex,
    sequenceIndex: seqIndex,
    eventIndex,
    ...(tupletIndex === undefined ? {} : { tupletIndex }),
  });
  const applyScope = (group: ReturnType<typeof createDynamicGroup>): void => {
    if (voice) group.voice = voice;
    if (staff !== undefined) group.staff = staff;
  };

  if (!partMeasure.dynamics) {
    partMeasure.dynamics = [];
  }

  // Check for existing dynamic at same position
  const existingIdx = partMeasure.dynamics.findIndex(
    (d) =>
      d.type !== "gradual" &&
      d.voice === voice &&
      d.staff === staff &&
      d.position.fraction[0] === position.fraction[0] &&
      d.position.fraction[1] === position.fraction[1],
  );

  if (existingIdx >= 0) {
    const existing = partMeasure.dynamics[existingIdx]!;
    const replacement = createDynamicGroup(value, position, existing.id);
    applyScope(replacement);
    if (
      existing.type === replacement.type &&
      dynamicSpelling(existing) === dynamicSpelling(replacement) &&
      JSON.stringify(existing.glyphs) === JSON.stringify(replacement.glyphs)
    ) {
      // Same value: remove it
      partMeasure.dynamics.splice(existingIdx, 1);
      if (partMeasure.dynamics.length === 0) {
        delete partMeasure.dynamics;
      }
    } else {
      // Different value: replace it
      partMeasure.dynamics[existingIdx] = replacement;
    }
  } else {
    // Add new dynamic
    const dynamic = createDynamicGroup(value, position);
    applyScope(dynamic);
    partMeasure.dynamics.push(dynamic);
  }

  return score;
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

/** Get the NoteEvent at the given location, or null. Supports tuplet inner events. */
function getEvent(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  tupletIndex?: number,
): NoteEvent | null {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex];
  if (!seq) return null;
  let ev: SequenceContent | undefined;
  if (tupletIndex !== undefined) {
    const t = seq.content[tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    ev = t.content[eventIndex];
  } else {
    ev = seq.content[eventIndex];
  }
  if (!ev || ev.type !== "event") return null;
  return ev;
}

function hasPlayableNotes(ev: NoteEvent): boolean {
  return !!ev.notes && ev.notes.length > 0;
}

function updateMarkings(ev: NoteEvent, fn: (markings: Markings) => void): void {
  if (!ev.markings) ev.markings = {};
  fn(ev.markings);
  if (Object.keys(ev.markings).length === 0) delete ev.markings;
}

/**
 * Compute the rhythmic position (fraction) of an event at a given index
 * by summing durations of all preceding events.
 */
function computeEventPosition(
  content: readonly SequenceContent[],
  eventIndex: number,
  tupletIndex?: number,
): RhythmicPosition | null {
  if (eventIndex < 0) return null;

  let beatSum = 0;

  if (tupletIndex !== undefined) {
    if (tupletIndex < 0 || tupletIndex >= content.length) return null;
    for (let i = 0; i < tupletIndex; i++) {
      const item = content[i];
      if (item) beatSum += sequenceContentBeats(item);
    }
    const tuplet = content[tupletIndex];
    if (!tuplet || tuplet.type !== "tuplet" || eventIndex >= tuplet.content.length) return null;
    let innerBeatSum = 0;
    for (let i = 0; i < eventIndex; i++) {
      const item = tuplet.content[i];
      if (item) innerBeatSum += sequenceContentBeats(item);
    }
    const innerBeats = tuplet.inner.multiple * durationToBeats(tuplet.inner.duration);
    const outerBeats = tuplet.outer.multiple * durationToBeats(tuplet.outer.duration);
    beatSum += innerBeats > 0 ? innerBeatSum * (outerBeats / innerBeats) : 0;
  } else {
    if (eventIndex >= content.length) return null;
    for (let i = 0; i < eventIndex; i++) {
      const item = content[i];
      if (item) beatSum += sequenceContentBeats(item);
    }
  }

  // Convert beats to a fraction with denominator 1 (beats are in quarter-note units)
  // Use [numerator * 4, denominator * 4] to express as fraction of whole note
  // MNX uses fractions of a whole note: 1 quarter = 1/4
  const numerator = Math.round(beatSum * 256);
  const denominator = 1024;
  const g = gcd(numerator, denominator);

  return {
    fraction: [numerator / g, denominator / g],
  };
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function ensureIdSpan(firstNote: { id?: string }, lastNote: { id?: string }): { start: string; end: string } {
  firstNote.id ??= generateNoteId();
  lastNote.id ??= generateNoteId();
  return { start: firstNote.id, end: lastNote.id };
}

function samePosition(a: RhythmicPosition, b: RhythmicPosition): boolean {
  return a.fraction[0] === b.fraction[0] && a.fraction[1] === b.fraction[1];
}

function sameSpan(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start === b.start && a.end === b.end;
}

function clearArpeggioObjectsAt(
  partMeasure: NonNullable<Score["parts"][number]["measures"][number]>,
  position: RhythmicPosition,
  span?: { start: string; end: string },
): void {
  if (partMeasure.arpeggios) {
    partMeasure.arpeggios = partMeasure.arpeggios.filter(
      (item) => !samePosition(item.position, position) || (span !== undefined && !sameSpan(item.span, span)),
    );
    if (partMeasure.arpeggios.length === 0) delete partMeasure.arpeggios;
  }
  if (partMeasure.nonArpeggios) {
    partMeasure.nonArpeggios = partMeasure.nonArpeggios.filter(
      (item) => !samePosition(item.position, position) || (span !== undefined && !sameSpan(item.span, span)),
    );
    if (partMeasure.nonArpeggios.length === 0) delete partMeasure.nonArpeggios;
  }
}

// ═══════════════════════════════════════════
// Patch-IR (plan*) siblings
// ═══════════════════════════════════════════
//
// These mirror the in-place mutators above but emit `ScorePatch[]` against
// stable ids (partId + eventId) so the same operation can be replayed
// through `applyPatchesToYDoc` in live (collaborative) mode. Callers that
// have already migrated to the patch bus should prefer the `plan*` form;
// legacy callers that mutate Immer drafts in place continue to use the
// non-`plan*` versions unchanged.
//
// Scope: covers the marking + fermata setters that map cleanly to
// SetEventMarkingPatch / SetEventFieldPatch, plus the measure-level
// dynamics + arpeggio setters that map to SetMeasureDynamicGroup /
// SetMeasureArpeggio. Functions that wrap/unwrap container content
// (setMultiNoteTremolo) are NOT covered here — they require generalized
// container wrap/unwrap patches that don't exist yet.

/** Resolve (partIndex, measureIndex, voice, eventIndex, tupletIndex?) to an EventLocator. */
function resolveEventLocator(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  tupletIndex?: number,
): EventLocator | null {
  const part = score.parts[partIndex];
  if (!part?.id) return null;
  const seq = part.measures[measureIndex]?.sequences[seqIndex];
  if (!seq) return null;
  let ev: SequenceContent | undefined;
  if (tupletIndex !== undefined) {
    const t = seq.content[tupletIndex];
    if (!t || t.type !== "tuplet") return null;
    ev = t.content[eventIndex];
  } else {
    ev = seq.content[eventIndex];
  }
  if (!ev || ev.type !== "event" || !ev.id) return null;
  return { sequencePath: { partId: part.id, measureIndex, voice: seqIndex }, eventId: ev.id };
}

/** Default-marking-object lookup so toggling matches the in-place mutator. */
function defaultMarkingValue<K extends keyof Markings>(): Markings[K] {
  // All current marking interfaces accept `{}` (all fields optional) — the
  // in-place mutator sets `{}` for plain toggles, so we match that here.
  return {} as Markings[K];
}

export function planToggleArticulation(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  articulation: ArticulationType,
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !ev.notes || ev.notes.length === 0) return null;
  const present = ev.markings?.[articulation] !== undefined;
  return [patch.setEventMarking(locator, articulation, present ? undefined : defaultMarkingValue<ArticulationType>())];
}

export function planSetBreathMark(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  symbol?: BreathMarkSymbol,
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const value = symbol === undefined ? undefined : symbol === "comma" ? {} : { symbol };
  return [patch.setEventMarking(locator, "breath", value)];
}

export function planSetCaesura(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  style?: CaesuraStyle,
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const value = style === undefined ? undefined : style === "normal" ? {} : { style };
  return [patch.setEventMarking(locator, "caesura", value)];
}

export function planSetSingleTremoloMarks(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  marks?: 1 | 2 | 3,
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  return [patch.setEventMarking(locator, "tremolo", marks === undefined ? undefined : { marks })];
}

export function planSetFermataShape(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  symbol?: FermataSymbol,
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const value = symbol === undefined ? undefined : symbol === "normal" ? {} : { symbol };
  return [patch.setEventField(locator, { field: "fermata", value })];
}

export function planSetTrillAccidental(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  accidental?: -1 | 0 | 1 | null,
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  const value = accidental === undefined ? undefined : accidental === null ? {} : { accidental };
  return [patch.setEventMarking(locator, "trill", value)];
}

export function planSetOrnaments(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  ornaments?: OrnamentType[],
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  const normalized = ornaments?.filter((orn): orn is OrnamentType => orn.length > 0) ?? [];
  return [patch.setEventMarking(locator, "ornaments", normalized.length === 0 ? undefined : normalized)];
}

export function planSetFingerings(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  fingers?: readonly number[],
  tupletIndex?: number,
): ScorePatch[] | null {
  const locator = resolveEventLocator(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!locator) return null;
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev || !hasPlayableNotes(ev)) return null;
  const sanitized = (fingers ?? []).map((finger) => Math.trunc(finger)).filter((finger) => finger >= 0 && finger <= 5);
  const value = sanitized.length === 0 ? undefined : sanitized.map((finger) => ({ finger }));
  return [patch.setEventMarking(locator, "fingerings", value)];
}

// ── measure-level plan* siblings ──────────────────────────────────────────

/** Resolve (partIndex, measureIndex) to a MeasurePath, or null if the part has no id. */
function resolveMeasurePath(score: Score, partIndex: number, measureIndex: number): MeasurePath | null {
  const part = score.parts[partIndex];
  if (!part?.id) return null;
  if (!part.measures[measureIndex]) return null;
  return { partId: part.id, measureIndex };
}

/**
 * Plan-IR equivalent of {@link toggleDynamic}. Emits an ID-addressed dynamic-group patch
 * matching the in-place mutator's toggle semantics:
 *   - same value at position → clear
 *   - different value at position → replace
 *   - no entry at position → add
 */
export function planToggleDynamic(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  value: DynamicValue,
): ScorePatch[] | null {
  const measurePath = resolveMeasurePath(score, partIndex, measureIndex);
  if (!measurePath) return null;
  const partMeasure = score.parts[partIndex]?.measures[measureIndex];
  const seq = partMeasure?.sequences[seqIndex];
  if (!partMeasure || !seq) return null;
  const position = computeEventPosition(seq.content, eventIndex);
  if (!position) return null;
  const voice = partMeasure.sequences.length > 1 ? (seq.voice ?? `v${seqIndex + 1}`) : undefined;
  const staff = dynamicStaffAtLocation(score, {
    partIndex,
    measureIndex,
    sequenceIndex: seqIndex,
    eventIndex,
  });
  const existing = partMeasure.dynamics?.find(
    (d) =>
      d.type !== "gradual" &&
      d.voice === voice &&
      d.staff === staff &&
      d.position.fraction[0] === position.fraction[0] &&
      d.position.fraction[1] === position.fraction[1],
  );
  const next = createDynamicGroup(value, position, existing?.id);
  if (voice) next.voice = voice;
  if (staff !== undefined) next.staff = staff;
  const same =
    existing?.type === next.type &&
    dynamicSpelling(existing) === dynamicSpelling(next) &&
    JSON.stringify(existing.glyphs) === JSON.stringify(next.glyphs);
  return [patch.setMeasureDynamicGroup(measurePath, next.id, same ? undefined : next)];
}

/**
 * Plan-IR equivalent of {@link setArpeggioMark}. Requires both first and
 * last notes of the target event to already have ids; returns null if not
 * (the in-place mutator allocates ids on the fly, but plan* must be pure).
 */
export function planSetArpeggioMark(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  kind?: ArpeggioMarkKind,
  tupletIndex?: number,
): ScorePatch[] | null {
  const measurePath = resolveMeasurePath(score, partIndex, measureIndex);
  if (!measurePath) return null;
  const partMeasure = score.parts[partIndex]?.measures[measureIndex];
  const seq = partMeasure?.sequences[seqIndex];
  if (!partMeasure || !seq) return null;
  const ev = getEvent(score, partIndex, measureIndex, seqIndex, eventIndex, tupletIndex);
  if (!ev) return null;
  if (kind !== undefined && (!ev.notes || ev.notes.length < 2)) return null;
  const position = computeEventPosition(seq.content as SequenceContent[], eventIndex, tupletIndex);
  if (!position) return null;
  const firstNote = ev.notes?.[0];
  const lastNote = ev.notes?.[ev.notes.length - 1];
  if (!firstNote?.id || !lastNote?.id) return null;
  const span = { start: firstNote.id, end: lastNote.id };
  return [patch.setMeasureArpeggio(measurePath, position, span, kind)];
}

/** Plan-IR equivalent of {@link setArpeggioDirection} — a thin wrapper over planSetArpeggioMark. */
export function planSetArpeggioDirection(
  score: Score,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  eventIndex: number,
  direction?: ArpeggioDirection | null,
  tupletIndex?: number,
): ScorePatch[] | null {
  const kind = direction === undefined ? undefined : direction === null ? "plain" : direction;
  return planSetArpeggioMark(score, partIndex, measureIndex, seqIndex, eventIndex, kind, tupletIndex);
}

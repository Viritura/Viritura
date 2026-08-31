import {
  clefLineFromBottom,
  clefReferencePitch,
  diatonicPosition,
  walkSequenceEvents,
  type Clef,
  type Markings,
  type NoteEvent,
  type Orientation,
  type Score,
  type Tuplet,
} from "@viritura/core";

import { resolveNotationSelectionTarget, type NotationSelectionTarget } from "../commands/notationInspectorCommands";
import {
  getEventAtLocation,
  resolveAnnotationLocation,
  type AnnotationLocation,
  type EventLocation,
} from "../score/ElementPath";
import { parseElementType } from "../score/elementTypes";
import { cloneScore } from "../score/scoreClone";
import { resolveSelectionEvents } from "../store/selectionUtils";
import type { KeyboardHandlerContext } from "./types";

interface LocatedEvent {
  event: NoteEvent;
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
}

interface OrientableMarking {
  orient?: Orientation;
}

function singleSelection(elementId: string) {
  return { kind: "single" as const, elementId, elementType: parseElementType(elementId) };
}

const FLIPPABLE_ARTICULATION_NAMES = new Set<keyof Markings>([
  "staccato",
  "staccatissimo",
  "staccatissimoWedge",
  "spiccato",
  "accent",
  "tenuto",
  "strongAccent",
  "softAccent",
  "stress",
  "unstress",
  "bowDirection",
]);

const STEM_ELEMENT_TYPES = new Set(["event", "rest", "note", "grace-note"]);

function oppositeOrientation(isAbove: boolean): Orientation {
  return isAbove ? "below" : "above";
}

function oppositeSide(isAbove: boolean): "up" | "down" {
  return isAbove ? "down" : "up";
}

function resolveClefForFlip(score: Score, partIndex: number, staffIndex: number, measureIndex: number): Clef {
  const staffNumber = staffIndex + 1;
  const defaultClef: Clef = staffNumber >= 2 ? { sign: "F", staffPosition: 2 } : { sign: "G", staffPosition: -2 };
  const part = score.parts[partIndex];
  if (!part) return defaultClef;
  for (let m = measureIndex; m >= 0; m--) {
    const measure = part.measures[m];
    if (measure?.clefs) {
      const staffClef = measure.clefs.find((clef) => clef.staff === staffNumber || clef.staff == null);
      if (staffClef) return staffClef.clef;
    }
  }
  return defaultClef;
}

function staffPositionFromTop(diatonic: number, clef: Clef): number {
  const clefRef = clefReferencePitch(clef);
  const clefLine = clefLineFromBottom(clef);
  return (4 - clefLine) * 2 - (diatonic - clefRef);
}

function computeEffectiveStemUp(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  event: NoteEvent,
): boolean {
  const measure = score.parts[partIndex]?.measures[measureIndex];
  const sequence = measure?.sequences[sequenceIndex];
  if (!measure || !sequence) return false;

  if (event.orient === "above") return true;
  if (event.orient === "below") return false;
  if (event.stemDirection === "up") return true;
  if (event.stemDirection === "down") return false;
  if (sequence.orient === "above") return true;
  if (sequence.orient === "below") return false;
  if (measure.sequences.length > 1) return sequenceIndex === 0;
  if (!event.notes?.length) return false;

  const staffIndex = (sequence.staff ?? 1) - 1;
  const clef = resolveClefForFlip(score, partIndex, staffIndex, measureIndex);
  const averagePosition =
    event.notes.reduce((sum, note) => sum + staffPositionFromTop(diatonicPosition(note.pitch), clef), 0) /
    event.notes.length;
  return averagePosition > 4;
}

function getTargetEvent(score: Score, target: NotationSelectionTarget): NoteEvent | null {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) return null;
  const sequence = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
  if (!sequence) return null;
  if (target.graceContainerIndex !== undefined) {
    const grace = sequence.content[target.graceContainerIndex];
    const event = grace?.type === "grace" ? grace.content[target.eventIndex] : undefined;
    return event?.type === "event" ? event : null;
  }
  if (target.tupletIndex !== undefined) {
    const container = sequence.content[target.tupletIndex];
    const event =
      container?.type === "tuplet" || container?.type === "tremolo" ? container.content[target.eventIndex] : undefined;
    return event?.type === "event" ? event : null;
  }
  const event = sequence.content[target.eventIndex];
  return event?.type === "event" ? event : null;
}

function findEventById(score: Score, eventId: string): LocatedEvent | null {
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const measure = part.measures[measureIndex]!;
      for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
        for (const { event } of walkSequenceEvents(measure.sequences[sequenceIndex]!.content)) {
          if (event.id === eventId) return { event, partIndex, measureIndex, sequenceIndex };
        }
      }
    }
  }
  return null;
}

function flipSlur(score: Score, elementId: string): boolean {
  const target = resolveNotationSelectionTarget(singleSelection(elementId), score);
  if (target?.elementType !== "slur" || target.slurIndex === undefined || target.sequenceIndex === undefined) {
    return false;
  }
  const source = getTargetEvent(score, target);
  const slur = source?.slurs?.[target.slurIndex];
  if (!source || !slur) return false;

  const targetEvent = findEventById(score, slur.target);
  const sourceStemUp = computeEffectiveStemUp(
    score,
    target.partIndex,
    target.measureIndex,
    target.sequenceIndex,
    source,
  );
  const targetStemUp = targetEvent
    ? computeEffectiveStemUp(
        score,
        targetEvent.partIndex,
        targetEvent.measureIndex,
        targetEvent.sequenceIndex,
        targetEvent.event,
      )
    : sourceStemUp;
  const autoAbove = sourceStemUp !== targetStemUp || !sourceStemUp;
  const startAbove = slur.side === "up" || (slur.side === undefined && autoAbove);
  const endAbove = slur.sideEnd === "up" || (slur.sideEnd === undefined && startAbove);
  slur.side = oppositeSide(startAbove);
  slur.sideEnd = oppositeSide(endAbove);
  return true;
}

function computeAutoTieAbove(
  score: Score,
  target: NotationSelectionTarget,
  event: NoteEvent,
  noteIndex: number,
): boolean {
  const stemUp = computeEffectiveStemUp(score, target.partIndex, target.measureIndex, target.sequenceIndex ?? 0, event);
  const measure = score.parts[target.partIndex]?.measures[target.measureIndex];
  if ((measure?.sequences.length ?? 0) > 1) return stemUp;
  const notes = event.notes ?? [];
  if (notes.length <= 1) return !stemUp;
  const positions = notes.map((note) => diatonicPosition(note.pitch));
  const selected = positions[noteIndex];
  if (selected === undefined) return !stemUp;
  if (selected === Math.max(...positions)) return true;
  if (selected === Math.min(...positions)) return false;
  return !stemUp;
}

function flipTie(score: Score, elementId: string): boolean {
  const target = resolveNotationSelectionTarget(singleSelection(elementId), score);
  if (
    target?.elementType !== "tie" ||
    target.tieIndex === undefined ||
    target.noteIndex === undefined ||
    target.sequenceIndex === undefined
  ) {
    return false;
  }
  const event = getTargetEvent(score, target);
  const tie = event?.notes?.[target.noteIndex]?.ties?.[target.tieIndex];
  if (!event || !tie) return false;
  const autoAbove = computeAutoTieAbove(score, target, event, target.noteIndex);
  const currentAbove = tie.side === "up" || (tie.side === undefined && autoAbove);
  tie.side = oppositeSide(currentAbove);
  return true;
}

function flipTuplet(score: Score, elementId: string): boolean {
  const match = elementId.match(/^p(\d+)\/m(\d+)\/s(\d+)\/tuplet(\d+)$/);
  if (!match) return false;
  const partIndex = Number.parseInt(match[1]!, 10);
  const measureIndex = Number.parseInt(match[2]!, 10);
  const sequenceIndex = Number.parseInt(match[3]!, 10);
  const tupletOrdinal = Number.parseInt(match[4]!, 10);
  const sequence = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  const content = sequence?.content.filter((item): item is Tuplet => item.type === "tuplet")[tupletOrdinal];
  if (!content) return false;

  const tuplet = content as Tuplet;
  const stemsUp = tuplet.content
    .filter((event): event is NoteEvent => event.type === "event")
    .filter((event) => computeEffectiveStemUp(score, partIndex, measureIndex, sequenceIndex, event)).length;
  const eventCount = tuplet.content.filter((event) => event.type === "event").length;
  const autoAbove = eventCount === 0 || stemsUp * 2 >= eventCount;
  const currentAbove =
    tuplet.orient === "above" || ((tuplet.orient === undefined || tuplet.orient === "auto") && autoAbove);
  tuplet.orient = oppositeOrientation(currentAbove);
  return true;
}

function getSelectedEvent(score: Score, elementId: string): { event: NoteEvent; location: EventLocation } | null {
  const target = resolveNotationSelectionTarget(singleSelection(elementId), score);
  const event = target ? getTargetEvent(score, target) : null;
  if (!target || !event || target.sequenceIndex === undefined || target.eventIndex === undefined) return null;
  return {
    event,
    location: {
      partIndex: target.partIndex,
      measureIndex: target.measureIndex,
      sequenceIndex: target.sequenceIndex,
      eventIndex: target.eventIndex,
      ...(target.tupletIndex !== undefined && { tupletIndex: target.tupletIndex }),
    },
  };
}

function flipMarkingOrientation(marking: OrientableMarking, autoAbove: boolean): void {
  const currentAbove =
    marking.orient === "above" || ((marking.orient === undefined || marking.orient === "auto") && autoAbove);
  marking.orient = oppositeOrientation(currentAbove);
}

function flipEventSubElement(score: Score, elementId: string): boolean {
  const selected = getSelectedEvent(score, elementId);
  if (!selected) return false;
  const { event, location } = selected;
  const sequenceCount = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences.length ?? 1;
  const stemUp = computeEffectiveStemUp(
    score,
    location.partIndex,
    location.measureIndex,
    location.sequenceIndex,
    event,
  );

  if (elementId.endsWith("/ferm") || elementId.endsWith("/fermata")) {
    if (!event.fermata) return false;
    const autoAbove = sequenceCount <= 1 || stemUp;
    flipMarkingOrientation(event.fermata, autoAbove);
    return true;
  }

  const articulationMatch = elementId.match(/\/art-([^/]+)$/);
  if (!articulationMatch || !event.markings) return false;
  const names = articulationMatch[1]!.split(".");
  const autoAbove = names.includes("bowDirection")
    ? true
    : sequenceCount > 1
      ? location.sequenceIndex % 2 === 0
      : !stemUp;
  let changed = false;
  for (const name of names) {
    if (!FLIPPABLE_ARTICULATION_NAMES.has(name as keyof Markings)) continue;
    const marking = event.markings[name as keyof Markings];
    if (!marking || typeof marking !== "object") continue;
    flipMarkingOrientation(marking as OrientableMarking, autoAbove);
    changed = true;
  }
  return changed;
}

function resolveAnnotationIndex<T extends { id?: string }>(
  items: readonly T[] | undefined,
  location: AnnotationLocation,
): number {
  if (!items) return -1;
  if (location.annotationIndex !== undefined) return location.annotationIndex;
  if (location.annotationId !== undefined) return items.findIndex((item) => item.id === location.annotationId);
  return -1;
}

function flipAnnotation(score: Score, elementId: string): boolean {
  const location = resolveAnnotationLocation(elementId);
  if (!location || location.kind !== "part" || location.partIndex === undefined) return false;
  const measure = score.parts[location.partIndex]?.measures[location.measureIndex];
  if (!measure) return false;

  if (location.type === "dyn" || location.type === "hairpin") {
    const index = resolveAnnotationIndex(measure.dynamics, location);
    const dynamic = measure.dynamics?.[index];
    if (!dynamic) return false;
    dynamic.orient = dynamic.orient === "above" ? "below" : "above";
    return true;
  }
  if (location.type === "ottava") {
    const ottava = measure.ottavas?.[location.annotationIndex ?? -1];
    if (!ottava) return false;
    const autoAbove = ottava.value > 0;
    const currentAbove =
      ottava.orient === "above" || ((ottava.orient === undefined || ottava.orient === "auto") && autoAbove);
    ottava.orient = oppositeOrientation(currentAbove);
    return true;
  }
  if (location.type === "expr") {
    const expression = measure.expressions?.[location.annotationIndex ?? -1];
    if (!expression) return false;
    expression.placement = expression.placement === "above" ? "below" : "above";
    return true;
  }
  return false;
}

function flipSingleElement(score: Score, elementId: string): boolean {
  if (elementId.startsWith("slur/")) return flipSlur(score, elementId);
  if (elementId.startsWith("tie/")) return flipTie(score, elementId);
  if (/\/tuplet\d+$/.test(elementId)) return flipTuplet(score, elementId);
  if (/\/(?:art-[^/]+|ferm|fermata)$/.test(elementId)) return flipEventSubElement(score, elementId);
  if (resolveAnnotationLocation(elementId)) return flipAnnotation(score, elementId);
  return false;
}

function isSpecializedFlipId(elementId: string): boolean {
  return (
    elementId.startsWith("slur/") ||
    elementId.startsWith("tie/") ||
    /\/(?:tuplet\d+|art-[^/]+|ferm|fermata)$/.test(elementId) ||
    resolveAnnotationLocation(elementId) !== null
  );
}

function flipSelectedEvents(currentScore: Score, ctx: KeyboardHandlerContext): boolean {
  const locations = resolveSelectionEvents(ctx.getSelection(), currentScore);
  if (locations.length === 0) return false;
  const nextScore = cloneScore(currentScore);
  let changed = false;

  for (const location of locations) {
    const currentEvent = getEventAtLocation(currentScore, location);
    const nextEvent = getEventAtLocation(nextScore, location);
    if (currentEvent?.type !== "event" || nextEvent?.type !== "event") continue;
    const currentUp = computeEffectiveStemUp(
      currentScore,
      location.partIndex,
      location.measureIndex,
      location.sequenceIndex,
      currentEvent,
    );
    nextEvent.orient = currentUp ? "below" : "above";
    changed = true;
  }
  if (!changed) return false;
  ctx.updateScore(nextScore);
  return true;
}

/** F key: flip the selected item's effective vertical direction or placement. */
export function handleFlip(ctx: KeyboardHandlerContext): boolean {
  const currentScore = ctx.getScore();
  const selection = ctx.getSelection();
  if (!currentScore || selection.kind === "none") return false;

  if (
    selection.kind === "single" &&
    (isSpecializedFlipId(selection.elementId) || !STEM_ELEMENT_TYPES.has(selection.elementType))
  ) {
    const nextScore = cloneScore(currentScore);
    if (!flipSingleElement(nextScore, selection.elementId)) return false;
    ctx.updateScore(nextScore);
    return true;
  }

  return flipSelectedEvents(currentScore, ctx);
}

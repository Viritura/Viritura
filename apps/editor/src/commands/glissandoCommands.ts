import type { Glissando, GlissandoStyle, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import { eventBeatPosition } from "../app/timedAnnotationPosition";
import { produce } from "../score/scoreClone";
import { expandCondensedSpannerIds, resolveCondensedSelectionEvents } from "../score/condensedWriteback";
import type { EventLocation } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";

export type GlissandoKind = NonNullable<Glissando["kind"]>;

function shareRepeat(score: Score, first: EventLocation, second: EventLocation): boolean {
  if (first.partIndex !== second.partIndex) return false;
  const earliest = Math.min(first.measureIndex, second.measureIndex);
  const latest = Math.max(first.measureIndex, second.measureIndex);
  // Repeat ends use the nearest preceding start, or the start of the score.
  let start = 0;
  for (const [index, measure] of score.global.measures.entries()) {
    if (measure.repeatStart) start = index;
    if (!measure.repeatEnd) continue;
    const times = measure.repeatEnd.times ?? 2;
    if (Number.isInteger(times) && times > 1 && times <= 1000 && start <= earliest && latest <= index) return true;
  }
  return false;
}

function sameEvent(first: EventLocation, second: EventLocation): boolean {
  return (
    first.partIndex === second.partIndex &&
    first.measureIndex === second.measureIndex &&
    first.sequenceIndex === second.sequenceIndex &&
    first.tupletIndex === second.tupletIndex &&
    first.eventIndex === second.eventIndex
  );
}

function selectionOrder(
  score: Score,
  selection: Extract<SelectionState, { kind: "multi" | "range" }>,
  selectedScoreIndex: number,
  events: EventLocation[],
): EventLocation[] {
  const ids = selection.kind === "multi" ? selection.elementIds : [selection.startElementId, selection.endElementId];
  const ordered: EventLocation[] = [];
  for (const elementId of ids) {
    const single: SelectionState = {
      kind: "single",
      elementId,
      elementType: "event",
      ...(selection.measureAnchor && { measureAnchor: selection.measureAnchor }),
    };
    for (const location of resolveCondensedSelectionEvents(score, single, selectedScoreIndex)) {
      const event = events.find((candidate) => sameEvent(candidate, location));
      if (event && !ordered.some((candidate) => sameEvent(candidate, event))) ordered.push(event);
    }
  }
  return ordered.length === events.length ? ordered : events;
}

function eventBeat(score: Score, location: EventLocation): number {
  const sequence = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) throw new Error("Unable to resolve the selected line endpoint.");
  return eventBeatPosition(sequence, location);
}

export function resolveGlissandoSelectionEvents(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
): EventLocation[] {
  const events = resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  if (events.length !== 2) return events;
  if ((selection.kind === "multi" || selection.kind === "range") && shareRepeat(score, events[0]!, events[1]!)) {
    return selectionOrder(score, selection, selectedScoreIndex, events);
  }
  return events.sort(
    (first, second) =>
      first.partIndex - second.partIndex ||
      first.measureIndex - second.measureIndex ||
      eventBeat(score, first) - eventBeat(score, second),
  );
}

export interface AddGlissandoParams {
  sourceEventId: string;
  targetEventId: string;
  kind?: GlissandoKind;
  style?: GlissandoStyle;
  playbackType?: Glissando["playbackType"];
  text?: string;
  showText?: boolean;
}

export interface SetGlissandoPropertiesParams {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
  graceContainerIndex?: number;
  glissandoIndex?: number;
  target?: string;
  kind?: GlissandoKind;
  style?: GlissandoStyle;
  playbackType?: Glissando["playbackType"];
  text?: string | null;
  showText?: boolean;
}

interface LocatedEvent {
  event: NoteEvent;
  partIndex: number;
}

function findEventById(score: Score, eventId: string): LocatedEvent | null {
  let sanitizedMatch: LocatedEvent | null = null;
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    for (const measure of score.parts[partIndex]!.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          if (event.id === eventId) return { event, partIndex };
          if (event.id?.replaceAll("/", "_") === eventId) sanitizedMatch ??= { event, partIndex };
        }
      }
    }
  }
  return sanitizedMatch;
}

function requireEndpoint(score: Score, eventId: string, name: "Source" | "Target"): LocatedEvent {
  const endpoint = findEventById(score, eventId);
  if (!endpoint) throw new Error(`${name} event ${eventId} was not found.`);
  if (!endpoint.event.notes?.length) throw new Error(`${name} endpoint must be a note or chord.`);
  return endpoint;
}

/** Glissandos are conventionally engraved wavy; portamento uses a straight line. */
export function defaultGlissandoStyle(kind: GlissandoKind): GlissandoStyle {
  return kind === "portamento" ? "straight" : "wavy";
}

export function addGlissando(score: Score, params: AddGlissandoParams): Score {
  if (params.sourceEventId === params.targetEventId) {
    throw new Error("Glissando endpoints must be different notes.");
  }
  const source = requireEndpoint(score, params.sourceEventId, "Source");
  const target = requireEndpoint(score, params.targetEventId, "Target");
  if (source.partIndex !== target.partIndex) {
    throw new Error("Glissando endpoints must belong to the same part.");
  }

  const glissandos = source.event.glissandos ?? [];
  const existingIndex = glissandos.findIndex((line) => line.target === params.targetEventId);
  const existing = glissandos[existingIndex];
  const kind = params.kind ?? existing?.kind ?? "glissando";
  const glissando: Glissando = {
    ...existing,
    target: params.targetEventId,
    kind,
    style: params.style ?? defaultGlissandoStyle(kind),
  };
  if (params.text) glissando.text = params.text;
  if (params.showText !== undefined) glissando.showText = params.showText;
  if (params.playbackType !== undefined) glissando.playbackType = params.playbackType;
  source.event.glissandos =
    existingIndex < 0
      ? [...glissandos, glissando]
      : glissandos.flatMap((line, index) => {
          if (index === existingIndex) return [glissando];
          return line.target === params.targetEventId ? [] : [line];
        });
  return score;
}

function eventAt(score: Score, params: SetGlissandoPropertiesParams): NoteEvent | null {
  const sequence = score.parts[params.partIndex]?.measures[params.measureIndex]?.sequences[params.sequenceIndex];
  if (!sequence) return null;
  let content: SequenceContent | undefined;
  if (params.graceContainerIndex !== undefined) {
    const container = sequence.content[params.graceContainerIndex];
    content = container?.type === "grace" ? container.content[params.eventIndex] : undefined;
  } else if (params.tupletIndex !== undefined) {
    const container = sequence.content[params.tupletIndex];
    content =
      container?.type === "tuplet" || container?.type === "tremolo" ? container.content[params.eventIndex] : undefined;
  } else {
    content = sequence.content[params.eventIndex];
  }
  return content?.type === "event" ? content : null;
}

export function setGlissandoProperties(score: Score, params: SetGlissandoPropertiesParams): Score | null {
  const source = eventAt(score, params);
  const glissando = source?.glissandos?.[params.glissandoIndex ?? 0];
  if (!source || !glissando) return null;

  if (params.target !== undefined) {
    const target = requireEndpoint(score, params.target, "Target");
    const sourceLocation = requireEndpoint(score, source.id ?? "", "Source");
    if (sourceLocation.partIndex !== target.partIndex) {
      throw new Error("Glissando endpoints must belong to the same part.");
    }
    if (params.target === source.id) throw new Error("Glissando endpoints must be different notes.");
    glissando.target = params.target;
  }
  if (params.kind !== undefined) glissando.kind = params.kind;
  if (params.style !== undefined) glissando.style = params.style;
  if (params.playbackType !== undefined) glissando.playbackType = params.playbackType;
  if (params.text === null) delete glissando.text;
  else if (params.text !== undefined) glissando.text = params.text;
  if (params.showText !== undefined) glissando.showText = params.showText;
  return score;
}

export function removeGlissandoByElementId(score: Score, elementId: string): Score | null {
  const match = /^gliss\/([^/]+)\/([^/]+)$/.exec(elementId);
  if (!match) return null;
  const [, sourceEventId, targetEventId] = match;
  if (!sourceEventId || !targetEventId) return null;

  const source = findEventById(score, sourceEventId)?.event;
  const index =
    source?.glissandos?.findIndex(
      (glissando) => glissando.target === targetEventId || glissando.target.replaceAll("/", "_") === targetEventId,
    ) ?? -1;
  if (!source?.glissandos || index < 0) return null;

  return produce(score, (draft) => {
    const draftSource = findEventById(draft, sourceEventId)?.event;
    if (!draftSource?.glissandos) return;
    draftSource.glissandos.splice(index, 1);
    if (draftSource.glissandos.length === 0) delete draftSource.glissandos;
  });
}

export function removeGlissandosByElementId(
  score: Score,
  elementIds: readonly string[],
  scoreIndex = 0,
  forceDirect = false,
): Score | null {
  let next = score;
  let removed = false;
  const ids = elementIds.filter((id) => id.startsWith("gliss/"));
  const expanded = forceDirect ? ids : ids.flatMap((id) => expandCondensedSpannerIds(score, id, scoreIndex));
  for (const id of new Set(expanded)) {
    const candidate = removeGlissandoByElementId(next, id);
    if (candidate) {
      next = candidate;
      removed = true;
    }
  }
  return removed ? next : null;
}

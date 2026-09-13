import type { Glissando, GlissandoStyle, NoteEvent, Score, SequenceContent } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import { produce } from "../score/scoreClone";

export type GlissandoKind = NonNullable<Glissando["kind"]>;

export interface AddGlissandoParams {
  sourceEventId: string;
  targetEventId: string;
  kind?: GlissandoKind;
  style?: GlissandoStyle;
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

export function addGlissando(score: Score, params: AddGlissandoParams): Score {
  if (params.sourceEventId === params.targetEventId) {
    throw new Error("Glissando endpoints must be different notes.");
  }
  const source = requireEndpoint(score, params.sourceEventId, "Source");
  const target = requireEndpoint(score, params.targetEventId, "Target");
  if (source.partIndex !== target.partIndex) {
    throw new Error("Glissando endpoints must belong to the same part.");
  }

  const glissando: Glissando = {
    target: params.targetEventId,
    kind: params.kind ?? "glissando",
    style: params.style ?? "straight",
  };
  if (params.text) glissando.text = params.text;
  if (params.showText !== undefined) glissando.showText = params.showText;
  source.event.glissandos = [...(source.event.glissandos ?? []), glissando];
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
  if (params.text === null) delete glissando.text;
  else if (params.text !== undefined) glissando.text = params.text;
  if (params.showText !== undefined) glissando.showText = params.showText;
  return score;
}

export function removeGlissandoByElementId(score: Score, elementId: string): Score | null {
  const [, sourceEventId, targetEventId] = elementId.split("/");
  if (!sourceEventId || !targetEventId || !elementId.startsWith("gliss/")) return null;

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

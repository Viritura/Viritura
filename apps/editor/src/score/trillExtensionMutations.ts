import { walkSequenceEvents, type NoteEvent, type Score } from "@viritura/core";
import { produce } from "./scoreClone";

interface LocatedEvent {
  event: NoteEvent;
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  order: number;
}

function findEventById(score: Score, eventId: string): LocatedEvent | null {
  let sanitizedMatch: LocatedEvent | null = null;
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    for (let measureIndex = 0; measureIndex < score.parts[partIndex]!.measures.length; measureIndex++) {
      const measure = score.parts[partIndex]!.measures[measureIndex]!;
      for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
        const sequence = measure.sequences[sequenceIndex]!;
        let order = 0;
        for (const { event } of walkSequenceEvents(sequence.content)) {
          const located = { event, partIndex, measureIndex, sequenceIndex, order };
          if (event.id === eventId) return located;
          if (event.id?.replaceAll("/", "_") === eventId) sanitizedMatch ??= located;
          order += 1;
        }
      }
    }
  }
  return sanitizedMatch;
}

function parseTrillLineId(elementId: string): { sourceId: string; targetId: string } | null {
  if (!elementId.startsWith("trill-line/")) return null;
  const [, sourceId, targetId] = elementId.split("/");
  return sourceId && targetId ? { sourceId, targetId } : null;
}

export function trillExtensionSourceId(elementId: string): string | null {
  return parseTrillLineId(elementId)?.sourceId ?? null;
}

export function reanchorTrillExtension(
  score: Score,
  elementId: string,
  targetEventId: string,
  targetEdge: "start" | "end" = "start",
): Score {
  const ids = parseTrillLineId(elementId);
  if (!ids || (ids.sourceId === targetEventId && targetEdge !== "end")) return score;
  const source = findEventById(score, ids.sourceId);
  const target = findEventById(score, targetEventId);
  if (
    !source ||
    !target ||
    source.partIndex !== target.partIndex ||
    source.sequenceIndex !== target.sequenceIndex ||
    target.measureIndex < source.measureIndex ||
    (target.measureIndex === source.measureIndex &&
      (target.order < source.order || (target.order === source.order && targetEdge !== "end"))) ||
    !target.event.notes?.length
  ) {
    return score;
  }
  const currentTarget = source.event.markings?.trill?.extension?.target;
  if (!currentTarget || currentTarget.replaceAll("/", "_") !== ids.targetId) return score;

  return produce(score, (draft) => {
    const draftSource = findEventById(draft, ids.sourceId)?.event;
    if (draftSource?.markings?.trill?.extension) {
      draftSource.markings.trill.extension.target = targetEventId;
      draftSource.markings.trill.extension.targetEdge = targetEdge;
    }
  });
}

export function trillExtensionPartIndex(score: Score | null, elementId: string): number | null {
  if (!score) return null;
  const ids = parseTrillLineId(elementId);
  return ids ? (findEventById(score, ids.sourceId)?.partIndex ?? null) : null;
}

export function removeTrillExtensionByElementId(score: Score, elementId: string): Score | null {
  const ids = parseTrillLineId(elementId);
  if (!ids) return null;
  const source = findEventById(score, ids.sourceId)?.event;
  const trill = source?.markings?.trill;
  if (!trill?.extension || trill.extension.target.replaceAll("/", "_") !== ids.targetId) return null;

  return produce(score, (draft) => {
    const draftSource = findEventById(draft, ids.sourceId)?.event;
    const draftTrill = draftSource?.markings?.trill;
    if (!draftTrill) return;
    if (draftTrill.showSymbol === false) delete draftSource.markings?.trill;
    else delete draftTrill.extension;
  });
}

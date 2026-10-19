import { patch, type Caesura, type Score, type ScorePatch } from "@viritura/core";
import { getEventAncestorId, getEventAtLocation, resolveEventLocation } from "../../score/ElementPath";

/** All staff copies deliberately use the same global identity. */
export function globalCaesuraMeasure(elementId: string): number | null {
  const match = /^m(\d+)\/caesura$/.exec(elementId);
  return match ? Number(match[1]) : null;
}

/** Barline IDs name the incoming measure; a hold belongs to the outgoing one. */
export function caesuraBarlineMeasure(elementId: string): number | null {
  const match = /^m(\d+)\/barline$/.exec(elementId);
  return match && Number(match[1]) > 0 ? Number(match[1]) - 1 : null;
}

export function selectedCaesura(score: Score, elementId: string): Caesura | undefined {
  const measureIndex = globalCaesuraMeasure(elementId);
  if (measureIndex !== null) return score.global.measures[measureIndex]?.caesura;
  if (!elementId.endsWith("/caesura")) return undefined;
  const location = resolveEventLocation(getEventAncestorId(elementId), score);
  const event = location ? getEventAtLocation(score, location) : null;
  return event?.type === "event" ? event.markings?.caesura : undefined;
}

export function planCaesuraProperties(
  score: Score,
  elementId: string,
  properties: Partial<Pick<Caesura, "style" | "marks">> | undefined,
): ScorePatch[] | null {
  const globalIndex = globalCaesuraMeasure(elementId);
  if (globalIndex !== null) {
    const measure = score.global.measures[globalIndex];
    if (!measure?.caesura) return null;
    return [
      patch.setGlobalMeasureField(globalIndex, {
        field: "caesura",
        value: properties === undefined ? undefined : { ...measure.caesura, ...properties },
      }),
    ];
  }
  const location = resolveEventLocation(getEventAncestorId(elementId), score);
  const event = location ? getEventAtLocation(score, location) : null;
  const part = location ? score.parts[location.partIndex] : undefined;
  if (!location || !part?.id || event?.type !== "event" || !event.id || !event.markings?.caesura) return null;
  return [
    patch.setEventMarking(
      {
        sequencePath: { partId: part.id, measureIndex: location.measureIndex, voice: location.sequenceIndex },
        eventId: event.id,
      },
      "caesura",
      properties === undefined ? undefined : { ...event.markings.caesura, ...properties },
    ),
  ];
}

import type { NoteEvent, Score } from "@viritura/core";
import {
  getEventAtLocation,
  resolveEventLocation,
  resolveFullMeasureRestLocation,
  resolveGraceLocation,
} from "../../score/ElementPath";

function leafEvent(score: Score, id: string): NoteEvent | null {
  const grace = resolveGraceLocation(id, score);
  if (grace) {
    const sequence = score.parts[grace.partIndex]?.measures[grace.measureIndex]?.sequences[grace.sequenceIndex];
    const root = grace.tupletIndex === undefined ? undefined : sequence?.content[grace.tupletIndex];
    const content = root?.type === "tuplet" || root?.type === "tremolo" ? root.content : sequence?.content;
    const container = content?.[grace.graceContainerIndex];
    return container?.type === "grace" ? (container.content[grace.graceNoteIndex] ?? null) : null;
  }
  const location = resolveEventLocation(id, score);
  const event = location && getEventAtLocation(score, location);
  return event?.type === "event" ? event : null;
}

export function removeFermata(score: Score, id: string): Score | null {
  if (!id.endsWith("/ferm")) return null;
  const parent = id.slice(0, -5);
  const event = leafEvent(score, parent);
  if (event?.fermata !== undefined) {
    delete event.fermata;
    return score;
  }
  const location = resolveFullMeasureRestLocation(parent, score);
  const sequence =
    location && score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence?.fullMeasure?.fermata || sequence.content.length > 0) return null;
  delete sequence.fullMeasure.fermata;
  return score;
}

export function removeEventOrnament(score: Score, id: string): Score | null {
  const match = /\/(ornament|trill)$/.exec(id);
  if (!match) return null;
  const event = leafEvent(score, id.slice(0, match.index));
  if (!event?.markings) return null;
  if (match[1] === "ornament") {
    if (event.markings.ornaments === undefined) return null;
    delete event.markings.ornaments;
  } else {
    if (event.markings.trill === undefined) return null;
    delete event.markings.trill;
  }
  if (Object.keys(event.markings).length === 0) delete event.markings;
  return score;
}

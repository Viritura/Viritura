import type { Score } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";

export interface TupletSelectionLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  tupletIndex: number;
}

/** Resolve a rendered tuplet-bracket ID, whose final number is a tuplet ordinal. */
export function resolveTupletSelectionLocation(score: Score, elementId: string): TupletSelectionLocation | null {
  const match = /^p(\d+)\/m(\d+)\/s(\d+)\/tuplet(\d+)$/.exec(elementId);
  if (!match) return null;
  const partIndex = Number(match[1]);
  const measureIndex = Number(match[2]);
  const sequenceIndex = Number(match[3]);
  const ordinal = Number(match[4]);
  const content = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex]?.content;
  if (!content) return null;
  let seen = -1;
  const tupletIndex = content.findIndex((item) => item.type === "tuplet" && ++seen === ordinal);
  return tupletIndex < 0 ? null : { partIndex, measureIndex, sequenceIndex, tupletIndex };
}

export function firstTupletEventLocation(location: TupletSelectionLocation): EventLocation {
  return { ...location, eventIndex: 0 };
}

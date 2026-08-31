import type { TupletBracket, TupletDisplaySetting, Orientation, Score } from "@viritura/core";
import { resolveEventLocation } from "../score/ElementPath";
import { cloneScore } from "../score/scoreClone";

export interface LayoutOverrideParams {
  event?: {
    staff?: number | null;
    stemDirection?: "up" | "down" | "auto" | null;
    orient?: Orientation | null;
  };
  sequence?: {
    orient?: Orientation | null;
  };
  tuplet?: {
    orient?: Orientation | null;
    bracket?: TupletBracket | null;
    showNumber?: TupletDisplaySetting | null;
    showValue?: TupletDisplaySetting | null;
  };
}

function setOrDelete<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined): void {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    delete target[key];
    return;
  }
  target[key] = value;
}

/**
 * Apply per-element layout overrides (staff, stem direction, orientation,
 * tuplet display) to the event identified by `elementId`. Returns a new score,
 * or the original score unchanged if the target cannot be resolved.
 */
export function applyLayoutOverrides(score: Score, elementId: string, params: LayoutOverrideParams): Score {
  const location = resolveEventLocation(elementId, score);
  if (!location) {
    return score;
  }

  const nextScore = cloneScore(score);
  const sequence =
    nextScore.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) {
    return score;
  }

  if (params.sequence) {
    setOrDelete(sequence, "orient", params.sequence.orient);
  }

  // When tupletIndex is set, the target is inside a tuplet — use tupletIndex
  // to find the tuplet container in sequence.content.
  const content =
    location.tupletIndex !== undefined ? sequence.content[location.tupletIndex] : sequence.content[location.eventIndex];
  if (content?.type === "event" && params.event) {
    setOrDelete(content, "staff", params.event.staff);
    setOrDelete(content, "stemDirection", params.event.stemDirection);
    setOrDelete(content, "orient", params.event.orient);
  }

  if (content?.type === "tuplet" && params.tuplet) {
    setOrDelete(content, "orient", params.tuplet.orient);
    setOrDelete(content, "bracket", params.tuplet.bracket);
    setOrDelete(content, "showNumber", params.tuplet.showNumber);
    setOrDelete(content, "showValue", params.tuplet.showValue);
  }

  return nextScore;
}

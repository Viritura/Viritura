import type { Score } from "@viritura/core";
import { resolveEventLocation } from "../score/ElementPath";
import { cloneScore } from "../score/scoreClone";

export type ColorTarget = "clef" | "key" | "ending" | "grace" | "segno" | "fine" | "coda";

export interface ColorSelectionContext {
  measureIndex: number;
  partIndex: number;
  sequenceIndex?: number;
  eventIndex?: number;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) {
    return null;
  }
  if (trimmed.length === 4) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function parseSelectionContext(elementId: string | undefined, score: Score): ColorSelectionContext | null {
  if (!elementId) return null;
  const measureMatch = elementId.match(/(?:^|\/)m(\d+)(?:\/|$)/);
  if (!measureMatch) return null;
  const measureIndex = Number.parseInt(measureMatch[1]!, 10);
  if (Number.isNaN(measureIndex) || measureIndex < 0 || measureIndex >= score.global.measures.length) {
    return null;
  }
  const partMatch = elementId.match(/(?:^|\/)p(\d+)(?:\/|$)/);
  const partIndex = partMatch ? Number.parseInt(partMatch[1]!, 10) : 0;
  const eventLoc = resolveEventLocation(elementId, score);
  if (!eventLoc) {
    return { measureIndex, partIndex };
  }
  return {
    measureIndex,
    partIndex: eventLoc.partIndex,
    sequenceIndex: eventLoc.sequenceIndex,
    eventIndex: eventLoc.eventIndex,
  };
}

type ColorableMeasureField = "key" | "ending" | "segno" | "fine" | "coda";

function setGlobalMeasureColor(
  score: Score,
  measureIndex: number,
  field: ColorableMeasureField,
  storedColor: string | null,
): Score {
  const next = cloneScore(score);
  const target = next.global.measures[measureIndex]?.[field];
  if (!target) return score;
  if (storedColor === null) delete target.color;
  else target.color = storedColor;
  return next;
}

function applyClefColor(score: Score, context: ColorSelectionContext, storedColor: string | null): Score {
  const next = cloneScore(score);
  const clef = next.parts[context.partIndex]?.measures[context.measureIndex]?.clefs?.[0]?.clef;
  if (!clef) return score;
  if (storedColor === null) delete clef.color;
  else clef.color = storedColor;
  return next;
}

function applyGraceColor(score: Score, context: ColorSelectionContext, storedColor: string | null): Score {
  const next = cloneScore(score);
  const partMeasure = next.parts[context.partIndex]?.measures[context.measureIndex];
  if (!partMeasure) return score;

  if (context.sequenceIndex !== undefined && context.eventIndex !== undefined) {
    const selected = partMeasure.sequences[context.sequenceIndex]?.content[context.eventIndex];
    if (selected?.type === "grace") {
      if (storedColor === null) delete selected.color;
      else selected.color = storedColor;
      return next;
    }
  }

  for (const sequence of partMeasure.sequences) {
    for (const content of sequence.content) {
      if (content.type !== "grace") continue;
      if (storedColor === null) delete content.color;
      else content.color = storedColor;
      return next;
    }
  }
  return score;
}

export function applyColorToTarget(
  score: Score,
  target: ColorTarget,
  color: string | null,
  context: ColorSelectionContext,
): Score {
  const storedColor = color === "#000000" ? null : color;
  if (target === "key" || target === "ending" || target === "segno" || target === "fine" || target === "coda") {
    return setGlobalMeasureColor(score, context.measureIndex, target, storedColor);
  }
  if (target === "clef") return applyClefColor(score, context, storedColor);
  if (target === "grace") return applyGraceColor(score, context, storedColor);
  return score;
}

import type { Score } from "@viritura/core";
import { cloneScore } from "../score/scoreClone";
import type { NotationSelectionTarget } from "./notationInspectorCommands";

export interface ColorSelectionTarget {
  kind: "clef" | "key" | "ending" | "grace" | "segno" | "fine" | "coda";
  label: string;
  color?: string;
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

function resolveGlobalColorTarget(
  measure: Score["global"]["measures"][number] | undefined,
  elementType: string,
): ColorSelectionTarget | null {
  if (!measure) return null;
  switch (elementType) {
    case "key":
      return measure.key ? { kind: "key", label: "key signature", color: measure.key.color } : null;
    case "volta":
      return measure.ending ? { kind: "ending", label: "ending", color: measure.ending.color } : null;
    case "segno":
      return measure.segno ? { kind: "segno", label: "segno", color: measure.segno.color } : null;
    case "fine":
      return measure.fine ? { kind: "fine", label: "fine", color: measure.fine.color } : null;
    case "coda":
      return measure.coda ? { kind: "coda", label: "coda", color: measure.coda.color } : null;
    default:
      return null;
  }
}

export function resolveColorSelectionTarget(
  score: Score,
  target: NotationSelectionTarget | null,
): ColorSelectionTarget | null {
  if (!target) return null;
  const globalTarget = resolveGlobalColorTarget(score.global.measures[target.measureIndex], target.elementType);
  if (globalTarget) return globalTarget;
  if (target.elementType === "clef") {
    const clef = score.parts[target.partIndex]?.measures[target.measureIndex]?.clefs?.[0]?.clef;
    return clef ? { kind: "clef", label: "clef", color: clef.color } : null;
  }
  if (
    target.graceContainerIndex === undefined &&
    target.sequenceIndex !== undefined &&
    target.eventIndex !== undefined
  ) {
    const content =
      score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex]?.content[
        target.eventIndex
      ];
    if (content?.type === "grace") {
      return { kind: "grace", label: "grace group", color: content.color };
    }
  }
  return null;
}

function getColorable(
  score: Score,
  target: NotationSelectionTarget,
  kind: ColorSelectionTarget["kind"],
): { color?: string } {
  const globalMeasure = score.global.measures[target.measureIndex]!;
  switch (kind) {
    case "key":
      return globalMeasure.key!;
    case "ending":
      return globalMeasure.ending!;
    case "segno":
      return globalMeasure.segno!;
    case "fine":
      return globalMeasure.fine!;
    case "coda":
      return globalMeasure.coda!;
    case "clef":
      return score.parts[target.partIndex]!.measures[target.measureIndex]!.clefs![0]!.clef;
    case "grace": {
      const content =
        score.parts[target.partIndex]!.measures[target.measureIndex]!.sequences[target.sequenceIndex!]!.content[
          target.eventIndex!
        ]!;
      if (content.type !== "grace") {
        throw new Error("Resolved color target is no longer a grace group.");
      }
      return content;
    }
  }
}

export function applyColorToSelection(score: Score, target: NotationSelectionTarget, color: string | null): Score {
  const selectionTarget = resolveColorSelectionTarget(score, target);
  if (!selectionTarget) return score;
  const next = cloneScore(score);
  const colorable = getColorable(next, target, selectionTarget.kind);
  if (color === null) delete colorable.color;
  else colorable.color = color;
  return next;
}

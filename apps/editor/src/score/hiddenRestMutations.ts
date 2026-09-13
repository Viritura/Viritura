import { DURATION_BEATS, isRest, type Duration, type NoteEvent, type Score, type Space } from "@viritura/core";
import { beatsToDuration } from "../commands/noteCommands";
import { produce } from "./scoreClone";

export const HIDDEN_REST_ID_PREFIX = "__viritura_hidden_space_";

export interface HiddenRestTarget {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  eventIndex: number;
  tupletIndex?: number;
}

function selectedContent(score: Score, target: HiddenRestTarget) {
  const sequence = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
  if (!sequence) return undefined;
  if (target.tupletIndex !== undefined) {
    const container = sequence.content[target.tupletIndex];
    return container?.type === "tuplet" ? container.content[target.eventIndex] : undefined;
  }
  return sequence.content[target.eventIndex];
}

function replaceSelectedContent(score: Score, target: HiddenRestTarget, replacement: NoteEvent | Space): Score {
  return produce(score, (draft) => {
    const sequence = draft.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
    if (!sequence) return;
    if (target.tupletIndex !== undefined) {
      const container = sequence.content[target.tupletIndex];
      if (container?.type === "tuplet") container.content[target.eventIndex] = replacement;
      return;
    }
    sequence.content[target.eventIndex] = replacement;
  });
}

function reduceFraction(numerator: number, denominator: number): [number, number] {
  let a = Math.abs(numerator);
  let b = Math.abs(denominator);
  while (b !== 0) [a, b] = [b, a % b];
  return [numerator / a, denominator / a];
}

function durationToFraction(duration: Duration): [number, number] {
  const dots = duration.dots ?? 0;
  const denominator = 2 ** dots;
  const dotMultiplier = 2 ** (dots + 1) - 1;
  const wholeNotes = (DURATION_BEATS[duration.base] * dotMultiplier) / (4 * denominator);
  let fractionDenominator = 1;
  while (!Number.isInteger(wholeNotes * fractionDenominator)) fractionDenominator *= 2;
  return reduceFraction(Math.round(wholeNotes * fractionDenominator), fractionDenominator);
}

export function fractionToDuration(fraction: readonly [number, number]): Duration | null {
  if (fraction[1] <= 0) return null;
  return beatsToDuration((fraction[0] / fraction[1]) * 4);
}

export function restMetadataLosses(event: NoteEvent): string[] {
  const losses: string[] = [];
  if (event.id !== undefined) losses.push("identifier");
  if (event.rest?.staffPosition !== undefined) losses.push("staff position");
  if (event.staff !== undefined) losses.push("staff assignment");
  if (event.stemDirection !== undefined) losses.push("stem direction");
  if (event.orient !== undefined) losses.push("orientation");
  if (event.slurs?.length) losses.push("slurs");
  if (event.glissandos?.length) losses.push("glissandos");
  if (event.markings !== undefined) losses.push("markings");
  if (event.fermata !== undefined) losses.push("fermata");
  if (event.lyrics !== undefined) losses.push("lyrics");
  return losses;
}

export function hiddenRestPlaceholderSuffix(target: Pick<HiddenRestTarget, "eventIndex" | "tupletIndex">): string {
  return target.tupletIndex === undefined
    ? `${HIDDEN_REST_ID_PREFIX}t${target.eventIndex}`
    : `${HIDDEN_REST_ID_PREFIX}t${target.tupletIndex}_i${target.eventIndex}`;
}

export function hiddenRestPlaceholderId(target: HiddenRestTarget): string {
  return `p${target.partIndex}/m${target.measureIndex}/s${target.sequenceIndex}/${hiddenRestPlaceholderSuffix(target)}`;
}

export function setRestHiddenInScore(score: Score, target: HiddenRestTarget, hidden: boolean): Score {
  const content = selectedContent(score, target);
  if (hidden) {
    if (content?.type !== "event" || !isRest(content)) return score;
    return replaceSelectedContent(score, target, {
      type: "space",
      duration: durationToFraction(content.duration),
    });
  }
  if (content?.type !== "space") return score;
  const duration = fractionToDuration(content.duration);
  if (!duration) return score;
  return replaceSelectedContent(score, target, { type: "event", duration, rest: {} });
}

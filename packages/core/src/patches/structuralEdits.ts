/**
 * Interpreter helpers for the measure-scoped structural patches:
 * global-measure fields, measure insert/remove, part-measure fields, and
 * anchor-free sequence-content replacement.
 *
 * Kept out of `applyToScore.ts` so that file stays a readable dispatcher and
 * each structural concern lives with its siblings. All functions mutate the
 * Immer draft in place, mirroring the note/event helpers in `applyToScore.ts`.
 */

import type { Draft } from "immer";
import type { Score } from "../model/score";
import type { GlobalMeasure, PartMeasure } from "../model/measure";
import type { Part } from "../model/part";
import { PatchTargetMissing } from "./locate";
import type {
  GlobalMeasureField,
  InsertMeasuresPatch,
  MeasurePath,
  PartMeasureField,
  RemoveMeasuresPatch,
  SequencePath,
  SetGlobalMeasureFieldPatch,
  SetPartMeasureFieldPatch,
  SetSequenceContentPatch,
} from "./types";

/**
 * A blank part-measure: a single voice holding an MNX full-measure rest.
 * `fullMeasure` is meter-independent, so irregular meters remain one bar rest
 * instead of being decomposed into ordinary duration rests.
 */
function blankPartMeasure(): PartMeasure {
  return {
    sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
  };
}

function assign<T>(target: Record<string, unknown>, key: string, value: T | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

export function applySetGlobalMeasureField(draft: Draft<Score>, p: SetGlobalMeasureFieldPatch): void {
  const measure = (draft as Score).global.measures[p.measureIndex];
  if (!measure) throw new PatchTargetMissing(`Global measure ${p.measureIndex} not found`);
  writeGlobalMeasureField(measure, p.update);
}

function writeGlobalMeasureField(measure: GlobalMeasure, update: GlobalMeasureField): void {
  const target = measure as unknown as Record<string, unknown>;
  switch (update.field) {
    case "time":
    case "key":
    case "tempos":
    case "barline":
    case "repeatStart":
    case "repeatEnd":
    case "ending":
      assign(target, update.field, update.value);
      return;
    default: {
      const _exhaustive: never = update;
      throw new Error(`Unhandled GlobalMeasureField: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function applyInsertMeasures(draft: Draft<Score>, p: InsertMeasuresPatch): void {
  const score = draft as Score;
  if (p.globalMeasures.length === 0) throw new PatchTargetMissing("insertMeasures requires at least one measure");
  const at = clampIndex(p.atIndex, score.global.measures.length);
  score.global.measures.splice(at, 0, ...p.globalMeasures.map((gm) => ({ ...gm })));
  for (const part of score.parts) {
    const blanks = p.globalMeasures.map(() => blankPartMeasure());
    part.measures.splice(Math.min(at, part.measures.length), 0, ...blanks);
  }
}

export function applyRemoveMeasures(draft: Draft<Score>, p: RemoveMeasuresPatch): void {
  const score = draft as Score;
  if (p.count <= 0) return;
  if (p.startIndex < 0 || p.startIndex >= score.global.measures.length) {
    throw new PatchTargetMissing(`removeMeasures: start ${p.startIndex} is out of range`);
  }
  score.global.measures.splice(p.startIndex, p.count);
  for (const part of score.parts) {
    part.measures.splice(p.startIndex, p.count);
  }
}

export function applySetPartMeasureField(draft: Draft<Score>, p: SetPartMeasureFieldPatch): void {
  const measure = resolvePartMeasure(draft as Score, p.measurePath);
  writePartMeasureField(measure, p.update);
}

function writePartMeasureField(measure: PartMeasure, update: PartMeasureField): void {
  const target = measure as unknown as Record<string, unknown>;
  switch (update.field) {
    case "clefs":
      assign(target, "clefs", update.value);
      return;
    default: {
      const _exhaustive: never = update.field;
      throw new Error(`Unhandled PartMeasureField: ${String(_exhaustive)}`);
    }
  }
}

export function applySetSequenceContent(draft: Draft<Score>, p: SetSequenceContentPatch): void {
  const measure = resolvePartMeasure(draft as Score, p.sequencePath);
  if (p.sequencePath.voice < 0) {
    throw new PatchTargetMissing(`setSequenceContent: voice ${p.sequencePath.voice} is negative`);
  }
  while (measure.sequences.length <= p.sequencePath.voice) {
    measure.sequences.push({ content: [] });
  }
  measure.sequences[p.sequencePath.voice]!.content = p.content;
}

function resolvePartMeasure(score: Score, path: MeasurePath | SequencePath): PartMeasure {
  const part = score.parts.find((pt) => pt.id === path.partId);
  if (!part) throw new PatchTargetMissing(`Part "${path.partId}" not found`);
  const measure = part.measures[path.measureIndex];
  if (!measure) throw new PatchTargetMissing(`Measure ${path.measureIndex} not found in part "${path.partId}"`);
  return measure;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, length);
}

/**
 * Normalize a part's `measures` array to `length`, padding with blank
 * full-bar-rest measures or truncating the tail. Used when a whole part is
 * added so it stays index-parallel with `global.measures`.
 */
export function normalizePartMeasures(part: Part, length: number): void {
  if (part.measures.length > length) {
    part.measures.length = length;
    return;
  }
  while (part.measures.length < length) {
    part.measures.push(blankPartMeasure());
  }
}

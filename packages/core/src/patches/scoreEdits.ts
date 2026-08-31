/**
 * Interpreter helpers for the score-level structural patches: whole-part
 * add/remove/field edits, score metadata, and root Viritura vendor extensions.
 *
 * Split from `applyToScore.ts` for the same reason as `structuralEdits.ts` —
 * the dispatcher stays readable and each concern lives with its siblings. All
 * functions mutate the Immer draft in place.
 */

import type { Draft } from "immer";
import type { Score } from "../model/score";
import type { Part } from "../model/part";
import { PatchTargetMissing } from "./locate";
import { normalizePartMeasures } from "./structuralEdits";
import type {
  AddPartPatch,
  PartField,
  RemovePartPatch,
  ScoreExtensionField,
  SetPartFieldPatch,
  SetScoreExtensionPatch,
  SetScoreMetadataPatch,
} from "./types";

export function applyAddPart(draft: Draft<Score>, p: AddPartPatch): void {
  const score = draft as Score;
  if (p.part.id && score.parts.some((pt) => pt.id === p.part.id)) {
    throw new PatchTargetMissing(`addPart: a part with id "${p.part.id}" already exists`);
  }
  const part: Part = { ...p.part, measures: [...p.part.measures] };
  normalizePartMeasures(part, score.global.measures.length);
  const at = p.index === undefined || p.index < 0 || p.index > score.parts.length ? score.parts.length : p.index;
  score.parts.splice(at, 0, part);
}

export function applyRemovePart(draft: Draft<Score>, p: RemovePartPatch): void {
  const score = draft as Score;
  const idx = score.parts.findIndex((pt) => pt.id === p.partId);
  if (idx < 0) throw new PatchTargetMissing(`removePart: part "${p.partId}" not found`);
  score.parts.splice(idx, 1);
}

export function applySetPartField(draft: Draft<Score>, p: SetPartFieldPatch): void {
  const score = draft as Score;
  const part = score.parts.find((pt) => pt.id === p.partId);
  if (!part) throw new PatchTargetMissing(`setPartField: part "${p.partId}" not found`);
  writePartField(part, p.update);
}

function writePartField(part: Part, update: PartField): void {
  const target = part as unknown as Record<string, unknown>;
  switch (update.field) {
    case "name":
      part.name = update.value;
      return;
    case "shortName":
    case "staves":
    case "transposition":
      if (update.value === undefined) delete target[update.field];
      else target[update.field] = update.value;
      return;
    default: {
      const _exhaustive: never = update;
      throw new Error(`Unhandled PartField: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function applySetScoreMetadata(draft: Draft<Score>, p: SetScoreMetadataPatch): void {
  const score = draft as Score;
  if (p.value === undefined) delete score.metadata;
  else score.metadata = p.value;
}

export function applySetScoreExtension(draft: Draft<Score>, p: SetScoreExtensionPatch): void {
  writeScoreExtension(draft as Score, p.update);
}

function writeScoreExtension(score: Score, update: ScoreExtensionField): void {
  const target = score as unknown as Record<string, unknown>;
  switch (update.field) {
    case "videoSync":
    case "soundProfile":
    case "textStyles":
      if (update.value === undefined) delete target[update.field];
      else target[update.field] = update.value;
      return;
    default: {
      const _exhaustive: never = update;
      throw new Error(`Unhandled ScoreExtensionField: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

import {
  compareChordSymbolPositions,
  generateUniqueId,
  isHarpInstrumentAt,
  resolveHarpPedalState,
  type GlobalMeasure,
  type HarpPedalSetting,
  type HarpPedalTuning,
  type Part,
  type Score,
} from "@viritura/core";
import { produce } from "../score/scoreClone";
import type { HarpPedalTarget } from "./harpPedalTarget";

export interface HarpPedalEdit {
  target: HarpPedalTarget;
  part: Part;
  globalMeasure: GlobalMeasure;
  original: HarpPedalSetting | undefined;
  inherited: HarpPedalSetting | undefined;
}

function settingAt(score: Score, target: HarpPedalTarget): HarpPedalSetting | undefined {
  return score.parts[target.partIndex]?.measures[target.measureIndex]?.harpPedals?.find(
    (setting) => compareChordSymbolPositions(setting.position, target.position) === 0,
  );
}

export function beginHarpPedalEdit(score: Score, target: HarpPedalTarget): HarpPedalEdit {
  const part = score.parts[target.partIndex]!;
  const original = settingAt(score, target);
  const inherited = resolveHarpPedalState(part, target.measureIndex, target.position.fraction);
  return {
    target: { ...target, position: { fraction: [...target.position.fraction] } },
    part,
    globalMeasure: score.global.measures[target.measureIndex]!,
    original: original && structuredClone(original),
    inherited: inherited && structuredClone(inherited),
  };
}

function sameSnapshot(a: HarpPedalSetting | undefined, b: HarpPedalSetting | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reject stale drafts instead of overwriting another edit or retargeting a changed bar. */
export function harpPedalEditError(score: Score | null, edit: HarpPedalEdit): string | null {
  const { target } = edit;
  const part = score?.parts[target.partIndex];
  const measure = score?.global.measures[target.measureIndex];
  if (!score || !part || !measure || !part.measures[target.measureIndex])
    return "The selected part or bar no longer exists.";
  if (part.id !== edit.part.id || (part.id === undefined && part !== edit.part))
    return "The selected part has changed.";
  if (edit.globalMeasure.id === undefined ? measure !== edit.globalMeasure : measure.id !== edit.globalMeasure.id)
    return "The selected bar has changed.";
  if (!isHarpInstrumentAt(part, target.measureIndex, target.position.fraction))
    return "The selected position is no longer on a harp.";
  if (
    (part.measures[target.measureIndex]?.harpPedals ?? []).filter(
      (setting) => compareChordSymbolPositions(setting.position, target.position) === 0,
    ).length > 1
  )
    return "There are conflicting pedal settings at this position.";
  if (!sameSnapshot(settingAt(score, target), edit.original))
    return "This pedal setting has changed. Close and reopen it.";
  if (!sameSnapshot(resolveHarpPedalState(part, target.measureIndex, target.position.fraction), edit.inherited))
    return "The preceding pedal setting has changed. Close and reopen it.";
  return null;
}

function existingPedalIds(score: Score): Set<string> {
  return new Set(
    score.parts.flatMap((part) =>
      part.measures.flatMap((measure) => (measure.harpPedals ?? []).map((item) => item.id)),
    ),
  );
}

export function applyHarpPedalEdit(score: Score, edit: HarpPedalEdit, tuning: HarpPedalTuning): Score {
  const error = harpPedalEditError(score, edit);
  if (error) throw new Error(error);
  const { target, original } = edit;
  const setting: HarpPedalSetting = {
    ...original,
    id: original?.id ?? generateUniqueId(existingPedalIds(score)),
    position: target.position,
    tuning,
    source: "manual",
  };
  return produce(score, (draft) => {
    const measure = draft.parts[target.partIndex]!.measures[target.measureIndex]!;
    const settings = measure.harpPedals ?? [];
    const index = settings.findIndex((item) => item.id === original?.id);
    if (index >= 0) settings[index] = setting;
    else settings.push(setting);
    settings.sort((a, b) => compareChordSymbolPositions(a.position, b.position));
    measure.harpPedals = settings;
  });
}

export function removeHarpPedalEdit(score: Score, edit: HarpPedalEdit): Score {
  const error = harpPedalEditError(score, edit);
  if (error) throw new Error(error);
  if (!edit.original) throw new Error("There is no pedal setting to remove.");
  return produce(score, (draft) => {
    const measure = draft.parts[edit.target.partIndex]!.measures[edit.target.measureIndex]!;
    measure.harpPedals = measure.harpPedals!.filter((setting) => setting.id !== edit.original!.id);
    if (measure.harpPedals.length === 0) delete measure.harpPedals;
  });
}

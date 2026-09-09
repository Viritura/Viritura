import { patch, type PositionedStaffConfig, type Score, type ScorePatch } from "@viritura/core";
import type { Selection } from "../store/selectionStore";

export interface StaffConfigSelectionTarget {
  partId: string;
  partIndex: number;
  measureIndex: number;
  staff: number;
}

export interface StaffLineConfigState {
  lines: number;
  hasExplicitChange: boolean;
}

function isMeasureStart(config: PositionedStaffConfig): boolean {
  return config.position === undefined || config.position.fraction[0] === 0;
}

function appliesToStaff(config: PositionedStaffConfig, staff: number): boolean {
  return (config.staff ?? 1) === staff;
}

export function resolveStaffConfigSelectionTarget(
  selection: Selection,
  score: Score,
): StaffConfigSelectionTarget | null {
  if (selection.kind === "measure") {
    const isSingleMeasure =
      selection.startPartIndex === selection.endPartIndex &&
      selection.startMeasure === selection.endMeasure &&
      selection.startStaffIndex === selection.endStaffIndex;
    if (!isSingleMeasure) return null;
    const part = score.parts[selection.startPartIndex];
    if (!part?.id || !part.measures[selection.startMeasure]) return null;
    return {
      partId: part.id,
      partIndex: selection.startPartIndex,
      measureIndex: selection.startMeasure,
      staff: (selection.startLocalStaffIndex ?? 0) + 1,
    };
  }

  return null;
}

export function readStaffLineConfig(score: Score, target: StaffConfigSelectionTarget): StaffLineConfigState {
  const part = score.parts[target.partIndex];
  let lines = 5;
  let hasExplicitChange = false;
  if (!part) return { lines, hasExplicitChange };

  for (let measureIndex = 0; measureIndex <= target.measureIndex; measureIndex++) {
    const configs = part.measures[measureIndex]?.staffConfigs ?? [];
    const orderedConfigs = configs
      .map((config, index) => ({ config, index }))
      .sort((left, right) => {
        const leftFraction = left.config.position?.fraction;
        const rightFraction = right.config.position?.fraction;
        const leftPosition = leftFraction ? leftFraction[0] / leftFraction[1] : 0;
        const rightPosition = rightFraction ? rightFraction[0] / rightFraction[1] : 0;
        return leftPosition - rightPosition || left.index - right.index;
      });
    for (const { config } of orderedConfigs) {
      if (!appliesToStaff(config, target.staff)) continue;
      if (measureIndex === target.measureIndex && !isMeasureStart(config)) continue;
      lines = config.config.lines ?? 5;
      if (measureIndex === target.measureIndex && isMeasureStart(config)) hasExplicitChange = true;
    }
  }
  return { lines, hasExplicitChange };
}

export function planSetStaffLineCount(score: Score, target: StaffConfigSelectionTarget, lines: number): ScorePatch[] {
  if (!Number.isSafeInteger(lines) || lines < 0) return [];
  const measure = score.parts[target.partIndex]?.measures[target.measureIndex];
  if (!measure) return [];
  const staffConfigs = [...(measure.staffConfigs ?? [])];
  let matchingIndex = -1;
  for (let index = 0; index < staffConfigs.length; index++) {
    const config = staffConfigs[index]!;
    if (appliesToStaff(config, target.staff) && isMeasureStart(config)) matchingIndex = index;
  }
  if (matchingIndex >= 0) {
    const existing = staffConfigs[matchingIndex]!;
    staffConfigs[matchingIndex] = {
      ...existing,
      config: { ...existing.config, lines },
    };
  } else {
    staffConfigs.push({
      config: { lines },
      ...(target.staff > 1 ? { staff: target.staff } : {}),
    });
  }
  return [
    patch.setPartMeasureField(
      { partId: target.partId, measureIndex: target.measureIndex },
      { field: "staffConfigs", value: staffConfigs },
    ),
  ];
}

export function planClearStaffLineCount(score: Score, target: StaffConfigSelectionTarget): ScorePatch[] {
  const measure = score.parts[target.partIndex]?.measures[target.measureIndex];
  if (!measure?.staffConfigs) return [];
  const staffConfigs = measure.staffConfigs.filter(
    (config) => !(appliesToStaff(config, target.staff) && isMeasureStart(config)),
  );
  if (staffConfigs.length === measure.staffConfigs.length) return [];
  return [
    patch.setPartMeasureField(
      { partId: target.partId, measureIndex: target.measureIndex },
      { field: "staffConfigs", value: staffConfigs.length > 0 ? staffConfigs : undefined },
    ),
  ];
}

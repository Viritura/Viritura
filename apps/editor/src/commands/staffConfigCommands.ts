import { patch, type PositionedStaffConfig, type Score, type ScorePatch } from "@viritura/core";
import type { Selection } from "../store/selectionStore";

export interface StaffConfigSelectionTarget {
  partId: string;
  partIndex: number;
  measureIndex: number;
  endMeasureIndex: number;
  staff: number;
}

export interface StaffLineConfigState {
  lines: number | null;
  origin: "default" | "inherited" | "explicit";
  hasChangesInSelection: boolean;
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
    const isSingleStaff =
      selection.startPartIndex === selection.endPartIndex &&
      selection.startStaffIndex === selection.endStaffIndex &&
      (selection.startLocalStaffIndex ?? 0) === (selection.endLocalStaffIndex ?? 0);
    if (!isSingleStaff) return null;
    const measureIndex = Math.min(selection.startMeasure, selection.endMeasure);
    const endMeasureIndex = Math.max(selection.startMeasure, selection.endMeasure);
    const part = score.parts[selection.startPartIndex];
    if (!part?.id || !part.measures[measureIndex] || !part.measures[endMeasureIndex]) return null;
    return {
      partId: part.id,
      partIndex: selection.startPartIndex,
      measureIndex,
      endMeasureIndex,
      staff: (selection.startLocalStaffIndex ?? 0) + 1,
    };
  }

  return null;
}

export function readStaffLineConfig(score: Score, target: StaffConfigSelectionTarget): StaffLineConfigState {
  const part = score.parts[target.partIndex];
  let lines: number | null = 5;
  let origin: StaffLineConfigState["origin"] = "default";
  let hasChangesInSelection = false;
  if (!part) return { lines, origin, hasChangesInSelection };

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
      origin = measureIndex === target.measureIndex ? "explicit" : "inherited";
    }
  }

  if (target.endMeasureIndex === target.measureIndex) {
    hasChangesInSelection = origin === "explicit";
  } else {
    const selectionStartLines = lines;
    for (let measureIndex = target.measureIndex; measureIndex <= target.endMeasureIndex; measureIndex++) {
      for (const config of part.measures[measureIndex]?.staffConfigs ?? []) {
        if (!appliesToStaff(config, target.staff)) continue;
        hasChangesInSelection = true;
        if ((config.config.lines ?? 5) !== selectionStartLines) lines = null;
      }
    }
  }
  return { lines, origin, hasChangesInSelection };
}

export function planSetStaffLineCount(score: Score, target: StaffConfigSelectionTarget, lines: number): ScorePatch[] {
  if (!Number.isSafeInteger(lines) || lines < 0) return [];
  const part = score.parts[target.partIndex];
  const measure = part?.measures[target.measureIndex];
  if (!measure) return [];
  if (target.endMeasureIndex > target.measureIndex) {
    const patches: ScorePatch[] = [];
    for (let measureIndex = target.measureIndex; measureIndex <= target.endMeasureIndex; measureIndex++) {
      const current = part.measures[measureIndex];
      if (!current) continue;
      const retained = (current.staffConfigs ?? []).filter((config) => !appliesToStaff(config, target.staff));
      const existingStart = (current.staffConfigs ?? []).findLast(
        (config) => appliesToStaff(config, target.staff) && isMeasureStart(config),
      );
      const staffConfigs =
        measureIndex === target.measureIndex
          ? [
              ...retained,
              existingStart
                ? { ...existingStart, config: { ...existingStart.config, lines } }
                : {
                    config: { lines },
                    ...(target.staff > 1 ? { staff: target.staff } : {}),
                  },
            ]
          : retained;
      patches.push(
        patch.setPartMeasureField(
          { partId: target.partId, measureIndex },
          { field: "staffConfigs", value: staffConfigs.length > 0 ? staffConfigs : undefined },
        ),
      );
    }

    const restoreMeasureIndex = target.endMeasureIndex + 1;
    const restoreMeasure = part.measures[restoreMeasureIndex];
    if (restoreMeasure) {
      const restoreTarget = {
        ...target,
        measureIndex: restoreMeasureIndex,
        endMeasureIndex: restoreMeasureIndex,
      };
      const restoreState = readStaffLineConfig(score, restoreTarget);
      if (restoreState.origin !== "explicit") {
        const staffConfigs = [
          ...(restoreMeasure.staffConfigs ?? []),
          {
            config: { lines: restoreState.lines ?? 5 },
            ...(target.staff > 1 ? { staff: target.staff } : {}),
          },
        ];
        patches.push(
          patch.setPartMeasureField(
            { partId: target.partId, measureIndex: restoreMeasureIndex },
            { field: "staffConfigs", value: staffConfigs },
          ),
        );
      }
    }
    return patches;
  }

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
  const part = score.parts[target.partIndex];
  if (!part) return [];
  const patches: ScorePatch[] = [];
  for (let measureIndex = target.measureIndex; measureIndex <= target.endMeasureIndex; measureIndex++) {
    const measure = part.measures[measureIndex];
    if (!measure?.staffConfigs) continue;
    const staffConfigs = measure.staffConfigs.filter((config) => {
      if (!appliesToStaff(config, target.staff)) return true;
      return target.endMeasureIndex === target.measureIndex && !isMeasureStart(config);
    });
    if (staffConfigs.length === measure.staffConfigs.length) continue;
    patches.push(
      patch.setPartMeasureField(
        { partId: target.partId, measureIndex },
        { field: "staffConfigs", value: staffConfigs.length > 0 ? staffConfigs : undefined },
      ),
    );
  }
  return patches;
}

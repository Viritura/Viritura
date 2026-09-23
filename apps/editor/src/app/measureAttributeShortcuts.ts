/**
 * Keyboard shortcuts that cycle a measure's global attributes (repeats,
 * endings, barlines, clefs). These share one shape — read the current value at
 * the selected measure, then advance or toggle it — so they live together
 * rather than inflating the keyboard wiring hook.
 */

import type { Barline, Clef, Ending, RepeatEnd, RepeatStart, Score } from "@viritura/core";

const BARLINE_CYCLE: Barline[] = [
  { type: "regular" },
  { type: "double" },
  { type: "final" },
  { type: "dashed" },
  { type: "heavy" },
  { type: "dotted" },
];

const CLEF_CYCLE: Clef[] = [
  { sign: "G", staffPosition: -2 },
  { sign: "F", staffPosition: 2 },
  { sign: "C", staffPosition: 0 },
  { sign: "C", staffPosition: 2 },
];

export interface MeasureAttributeShortcutDeps {
  getScore: () => Score | undefined;
  getSelectedMeasureIndex: () => number | null;
  getSelectedPartIndex: () => number | null;
  handleSetRepeatStart: (value: RepeatStart | null) => void;
  handleSetRepeatEnd: (value: RepeatEnd | null) => void;
  handleSetEnding: (value: Ending | null) => void;
  handleSetBarline: (value: Barline) => void;
  handleSetClef: (value: Clef) => void;
}

export interface MeasureAttributeShortcuts {
  onToggleRepeatStart: () => void;
  onToggleRepeatEnd: () => void;
  onEditEnding: () => void;
  onCycleBarline: () => void;
  onInsertClef: () => void;
}

/** Build the measure-attribute shortcut callbacks. Stable given stable deps. */
export function measureAttributeShortcuts(deps: MeasureAttributeShortcutDeps): MeasureAttributeShortcuts {
  const selectedMeasure = (): { score: Score; measureIndex: number } | undefined => {
    const score = deps.getScore();
    if (!score) return undefined;
    const measureIndex = deps.getSelectedMeasureIndex();
    if (measureIndex === null) return undefined;
    return { score, measureIndex };
  };

  return {
    onToggleRepeatStart: () => {
      const target = selectedMeasure();
      if (!target) return;
      const measure = target.score.global.measures[target.measureIndex];
      deps.handleSetRepeatStart(measure?.repeatStart ? null : {});
    },
    onToggleRepeatEnd: () => {
      const target = selectedMeasure();
      if (!target) return;
      const measure = target.score.global.measures[target.measureIndex];
      deps.handleSetRepeatEnd(measure?.repeatEnd ? null : {});
    },
    onEditEnding: () => {
      const target = selectedMeasure();
      if (!target) return;
      const measure = target.score.global.measures[target.measureIndex];
      deps.handleSetEnding(measure?.ending ? null : { duration: 1, numbers: [1] });
    },
    onCycleBarline: () => {
      const target = selectedMeasure();
      if (!target) return;
      const current = target.score.global.measures[target.measureIndex]?.barline?.type ?? "regular";
      const index = BARLINE_CYCLE.findIndex((barline) => barline.type === current);
      deps.handleSetBarline(BARLINE_CYCLE[(index + 1) % BARLINE_CYCLE.length]!);
    },
    onInsertClef: () => {
      const target = selectedMeasure();
      if (!target) return;
      const partIndex = deps.getSelectedPartIndex() ?? 0;
      const current = target.score.parts[partIndex]?.measures[target.measureIndex]?.clefs?.[0]?.clef;
      const sign = current?.sign ?? "G";
      const staffPosition = current?.staffPosition ?? -2;
      const index = CLEF_CYCLE.findIndex((clef) => clef.sign === sign && clef.staffPosition === staffPosition);
      deps.handleSetClef(CLEF_CYCLE[(index + 1) % CLEF_CYCLE.length]!);
    },
  };
}

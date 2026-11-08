import type { Score } from "@viritura/core";
import type { SelectionState } from "../../store/selectionStore";
import { cloneScore } from "../../score/scoreClone";

export type MeasureContentSelection = Extract<SelectionState, { kind: "measure" }>;

/** Clear musical content without removing bars or changing their structural settings. */
export function clearMeasureContent(score: Score, selection: MeasureContentSelection): Score {
  const next = cloneScore(score);
  const startPart = Math.min(selection.startPartIndex, selection.endPartIndex);
  const endPart = Math.min(Math.max(selection.startPartIndex, selection.endPartIndex), next.parts.length - 1);
  const startMeasure = Math.min(selection.startMeasure, selection.endMeasure);
  const endMeasure = Math.max(selection.startMeasure, selection.endMeasure);
  for (let p = startPart; p <= endPart; p++) {
    const part = next.parts[p];
    if (!part) continue;
    for (let m = startMeasure; m <= Math.min(endMeasure, part.measures.length - 1); m++) {
      const measure = part.measures[m];
      if (!measure) continue;
      for (const sequence of measure.sequences) {
        sequence.content = [];
        sequence.fullMeasure = sequence.fullMeasure ?? { visualDuration: { base: "whole" } };
        delete sequence.fullMeasure.fermata;
      }
      delete measure.dynamics;
      delete measure.expressions;
      delete measure.pedals;
      delete measure.ottavas;
      delete measure.arpeggios;
      delete measure.nonArpeggios;
      delete measure.beams;
      delete measure.measureRepeat;
    }
  }
  return next;
}

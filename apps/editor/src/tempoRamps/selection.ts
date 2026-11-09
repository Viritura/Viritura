import type { Score } from "@viritura/core";
import { playbackGlobalMeasures } from "@viritura/midi";
import { durationToBeats, sequenceContentBeats } from "../commands/noteCommands";
import { resolveNotationSelectionTarget } from "../commands/notationInspectorCommands";
import { resolveEventFromSubElement, resolveEventLocation } from "../score/ElementPath";
import type { Selection } from "../store/selectionStore";

export interface RampSpan {
  startMeasure: number;
  startBeat: number;
  endMeasure: number;
  endBeat: number;
}

export function barBeats(score: Score, index: number): number {
  for (let i = Math.min(index, score.global.measures.length - 1); i >= 0; i--) {
    const time = score.global.measures[i]?.time;
    if (time) {
      if (time.display === "senzaMisura" || (index === 0 && score.global.measures[0]?.number === 0)) {
        const playbackTime = playbackGlobalMeasures(score, [index])[0]?.time;
        if (playbackTime) return (playbackTime.count * 4) / playbackTime.unit;
      }
      return (time.count * 4) / time.unit;
    }
  }
  if (index === 0 && score.global.measures[0]?.number === 0) {
    const time = playbackGlobalMeasures(score, [0])[0]!.time!;
    return (time.count * 4) / time.unit;
  }
  return 4;
}

function eventPoint(score: Score, id: string, end: boolean): { measure: number; beat: number } | null {
  const location = resolveEventFromSubElement(id, score) ?? resolveEventLocation(id, score);
  if (!location) return null;
  const sequence = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) return null;
  const path =
    location.contentPath ??
    (location.tupletIndex === undefined ? [location.eventIndex] : [location.tupletIndex, location.eventIndex]);
  let content = sequence.content;
  let beat = 0;
  let scale = 1;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth]!;
    for (const item of content.slice(0, index)) beat += sequenceContentBeats(item) * scale;
    const item = content[index];
    if (!item || item.type === "grace") return null;
    if (depth === path.length - 1) {
      return { measure: location.measureIndex, beat: beat + (end ? sequenceContentBeats(item) * scale : 0) };
    }
    if (item.type !== "tuplet" && item.type !== "tremolo") return null;
    const innerBeats =
      item.type === "tuplet"
        ? durationToBeats(item.inner.duration) * item.inner.multiple
        : item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
    scale *= (durationToBeats(item.outer.duration) * item.outer.multiple) / innerBeats;
    content = item.content;
  }
  return null;
}

export function selectedRampSpan(score: Score, selection: Selection): RampSpan | null {
  if (selection.kind === "measure") {
    const startMeasure = Math.min(selection.startMeasure, selection.endMeasure);
    const endMeasure = Math.max(selection.startMeasure, selection.endMeasure);
    return { startMeasure, startBeat: 0, endMeasure, endBeat: barBeats(score, endMeasure) };
  }
  if (selection.kind === "multi" && selection.rhythmicRange) {
    const { start, end } = selection.rhythmicRange;
    return { startMeasure: start.measureIndex, startBeat: start.beat, endMeasure: end.measureIndex, endBeat: end.beat };
  }
  if (selection.kind === "range") {
    const a = eventPoint(score, selection.startElementId, false);
    const b = eventPoint(score, selection.endElementId, false);
    if (!a || !b) return null;
    const reversed = a.measure > b.measure || (a.measure === b.measure && a.beat > b.beat);
    const start = reversed ? b : a;
    const finish = eventPoint(score, reversed ? selection.startElementId : selection.endElementId, true);
    if (!finish) return null;
    return { startMeasure: start.measure, startBeat: start.beat, endMeasure: finish.measure, endBeat: finish.beat };
  }
  if (selection.kind !== "single") return null;
  const target = resolveNotationSelectionTarget(selection, score);
  if (!target) return null;
  const event = eventPoint(score, selection.elementId, false);
  return {
    startMeasure: target.measureIndex,
    startBeat: event?.beat ?? 0,
    endMeasure: target.measureIndex,
    endBeat: barBeats(score, target.measureIndex),
  };
}

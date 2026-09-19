import type { Score } from "@viritura/core";
import type { ClipboardSelection } from "../../commands/clipboardCommands";
import { voiceIndexWithinStaff } from "../clipboardTrackMapping";
import { beatsBetweenMeasures, type CaptureOrigin } from "./captureOrigin";
import { exactCaptureFraction } from "./captureFraction";

export interface CapturedSelection extends ClipboardSelection {
  captureOrigin: CaptureOrigin;
}

interface TimedAnnotation {
  measureOffset: number;
  offset?: [number, number];
  endMeasureOffset?: number;
  endOffset?: [number, number];
}

export function shiftSelectionOrigin(
  score: Score,
  selection: CapturedSelection,
  origin: CaptureOrigin,
): CapturedSelection {
  const delay =
    beatsBetweenMeasures(score, origin.measureIndex, selection.captureOrigin.measureIndex) +
    selection.captureOrigin.beat -
    origin.beat;
  if (delay <= 0) return selection;
  const measureDelta = selection.captureOrigin.measureIndex - origin.measureIndex;
  const shiftOffset = (offset?: [number, number]): [number, number] =>
    exactCaptureFraction((offset ? (offset[0] / offset[1]) * 4 : 0) + delay);
  function shiftAnnotation<T extends TimedAnnotation>(item: T): T {
    return {
      ...item,
      measureOffset: item.measureOffset + measureDelta,
      ...(item.offset ? { offset: shiftOffset(item.offset) } : {}),
      ...(item.endOffset ? { endOffset: shiftOffset(item.endOffset) } : {}),
      ...(item.endMeasureOffset === undefined ? {} : { endMeasureOffset: item.endMeasureOffset + measureDelta }),
    };
  }
  const tracks = selection.tracks ?? [
    {
      partOffset: 0,
      staffOffset: 0,
      sourceStaff:
        score.parts[selection.partIndex]?.measures[selection.measureIndex]?.sequences[selection.sequenceIndex]?.staff ??
        1,
      voiceIndex: voiceIndexWithinStaff(score, selection.partIndex, selection.measureIndex, selection.sequenceIndex),
      content: selection.events,
      clef: selection.clef,
      transposition: selection.transposition,
    },
  ];
  return {
    ...selection,
    captureOrigin: origin,
    measureIndex: origin.measureIndex,
    tracks: tracks.map((track) => ({
      ...track,
      leadIn: shiftOffset(track.leadIn),
      dynamics: track.dynamics?.map(shiftAnnotation),
    })),
    dynamics: selection.dynamics?.map(shiftAnnotation),
    chordSymbols: selection.chordSymbols?.map(shiftAnnotation),
  };
}

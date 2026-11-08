import type { Score, SequenceContent } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";
import type { ClipboardTrack } from "./ClipboardFragment";
import { exactCaptureDifference } from "./annotations";
import { partStaffOffset, voiceIndexWithinStaff } from "./clipboardTrackMapping";
import { getActiveClef } from "./sourceContext";

export interface TrackedEvent {
  event: SequenceContent;
  partOffset: number;
  voiceIndex: number;
  absBeat: number;
  measureIndex: number;
  sortKey: number;
  eventBeats: number;
  location?: EventLocation;
}

export function groupByTrack(
  score: Score,
  startPart: number,
  trackedEvents: TrackedEvent[],
): Map<string, TrackedEvent[]> {
  const trackMap = new Map<string, TrackedEvent[]>();
  for (const te of trackedEvents) {
    const partIndex = startPart + te.partOffset;
    const staff = score.parts[partIndex]?.measures[te.measureIndex]?.sequences[te.voiceIndex]?.staff ?? 1;
    const voice = voiceIndexWithinStaff(score, partIndex, te.measureIndex, te.voiceIndex);
    const key = `${te.partOffset}:${staff}:${voice}`;
    if (!trackMap.has(key)) trackMap.set(key, []);
    trackMap.get(key)!.push(te);
  }
  return trackMap;
}

function appendTrackGap(track: ClipboardTrack, end: number, start: number): void {
  if (end - start > 1e-9) track.content.push({ type: "space", duration: exactCaptureDifference(end, start) });
}

export function buildTrackFromEvents(
  score: Score,
  range: { startPart: number; startMeasure: number },
  events: TrackedEvent[],
  anchorStaffOffset: number,
  selectionStartBeat: number,
  selectionEndBeat?: number,
): ClipboardTrack {
  const first = events[0]!;
  const srcPartIndex = range.startPart + first.partOffset;
  const staff = score.parts[srcPartIndex]?.measures[first.measureIndex]?.sequences[first.voiceIndex]?.staff ?? 1;
  const track: ClipboardTrack = {
    partOffset: first.partOffset,
    voiceIndex: voiceIndexWithinStaff(score, srcPartIndex, first.measureIndex, first.voiceIndex),
    staffOffset: partStaffOffset(score, range.startPart, srcPartIndex, staff) - anchorStaffOffset,
    sourceStaff: staff,
    content: [],
    clef: getActiveClef(score, srcPartIndex, range.startMeasure),
    transposition: score.parts[srcPartIndex]?.transposition,
  };
  const leadIn = first.absBeat - selectionStartBeat;
  if (leadIn > 1e-9) track.leadIn = exactCaptureDifference(first.absBeat, selectionStartBeat);
  let endBeat = first.absBeat;
  for (const te of events) {
    appendTrackGap(track, te.absBeat, endBeat);
    track.content.push(te.event);
    endBeat = te.absBeat + te.eventBeats;
  }
  if (selectionEndBeat !== undefined) appendTrackGap(track, selectionEndBeat, endBeat);
  return track;
}

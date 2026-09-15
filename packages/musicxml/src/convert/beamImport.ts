import type { MnxBeam } from "../types";
import { findChildren } from "../xmlHelpers";

export interface ActiveBeam {
  eventIds: string[];
  level: number;
  startMeasureIndex: number;
  beams: MnxBeam[];
}

export interface CompletedBeam {
  beam: MnxBeam;
  startMeasureIndex: number;
}

interface BeamMark {
  level: number;
  value: string;
}

function addEvent(active: ActiveBeam, eventId: string): void {
  if (active.eventIds[active.eventIds.length - 1] !== eventId) active.eventIds.push(eventId);
}

function finishBeam(active: ActiveBeam): MnxBeam {
  return {
    events: active.eventIds,
    ...(active.beams.length > 0 ? { beams: active.beams } : {}),
  };
}

/**
 * Fold one MusicXML note's numbered beam marks into recursive MNX beams.
 * State is keyed by logical voice and persists across measures. Staff is not
 * part of the key because a cross-staff beam keeps one MusicXML voice while
 * its notes move between staves.
 */
export function processBeamMarks(
  note: Element,
  eventId: string,
  voice: string,
  measureIndex: number,
  activeByVoice: Map<string, ActiveBeam[]>,
): CompletedBeam[] {
  const marks: BeamMark[] = findChildren(note, "beam")
    .map((beam) => ({
      level: parseInt(beam.getAttribute("number") ?? "1", 10),
      value: (beam.textContent ?? "").trim(),
    }))
    .filter((mark) => Number.isSafeInteger(mark.level) && mark.level >= 1);
  if (marks.length === 0) return [];

  const active = activeByVoice.get(voice) ?? [];
  activeByVoice.set(voice, active);

  for (const mark of marks.filter((item) => item.value === "begin").sort((a, b) => a.level - b.level)) {
    const previous = active.findIndex((beam) => beam.level === mark.level);
    if (previous >= 0) active.splice(previous, 1);
    active.push({ eventIds: [eventId], level: mark.level, startMeasureIndex: measureIndex, beams: [] });
  }

  for (const mark of marks.filter((item) => item.value === "continue" || item.value === "end")) {
    const beam = active.find((candidate) => candidate.level === mark.level);
    if (beam) addEvent(beam, eventId);
  }

  const hooksByLevel = new Map<number, MnxBeam>();
  for (const mark of marks
    .filter((item) => item.value === "forward hook" || item.value === "backward hook")
    .sort((a, b) => a.level - b.level)) {
    const parent = hooksByLevel.get(mark.level - 1) ?? active.find((candidate) => candidate.level === mark.level - 1);
    if (parent) {
      const hook: MnxBeam = {
        events: [eventId],
        direction: mark.value === "forward hook" ? "right" : "left",
      };
      parent.beams ??= [];
      parent.beams.push(hook);
      hooksByLevel.set(mark.level, hook);
    }
  }

  const completed: CompletedBeam[] = [];
  for (const mark of marks.filter((item) => item.value === "end").sort((a, b) => b.level - a.level)) {
    const index = active.findIndex((beam) => beam.level === mark.level);
    if (index < 0) continue;
    const finished = active[index]!;
    active.splice(index, 1);
    const beam = finishBeam(finished);
    if (mark.level === 1) {
      if (beam.events.length >= 2) completed.push({ beam, startMeasureIndex: finished.startMeasureIndex });
    } else {
      const parent = active.find((candidate) => candidate.level === mark.level - 1);
      if (parent && beam.events.length > 0) parent.beams.push(beam);
    }
  }

  if (active.length === 0) activeByVoice.delete(voice);
  return completed;
}

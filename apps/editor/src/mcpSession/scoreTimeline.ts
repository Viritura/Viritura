/**
 * Read-only timing/picture queries backing the `score.get_timeline` and
 * `score.get_video_sync` MCP tools.
 *
 * `get_timeline` is the tool that lets a model verify score time against
 * picture: it reuses the existing `generateTimeline` output (whose
 * `measureStartTimes` / `measureStartBeats` / `tempoMap` are already the
 * playback source of truth) rather than widening the `@viritura/midi` barrel to
 * expose `buildTempoModel`. Payload size is bounded by a global-measure range.
 */

import { plainTextContent, type Score } from "@viritura/core";
import { generateTimeline } from "@viritura/midi";
import { measureReference, resolveMeasureRange, type MeasureReference } from "./measureReferences";
import { pagination } from "./queryFilters";

/** Largest measure window a single `get_timeline` call may return. */
const MAX_TIMELINE_MEASURES = 512;

interface TimelineMeasureEntry extends MeasureReference {
  /** 1-based global measure number. */
  measure: number;
  /** 0-based play-through ordinal; > 0 for a repeated measure. */
  playthrough: number;
  startSeconds: number;
  endSeconds: number;
  /** Global quarter-note beat at this measure's start (tempo-model axis). */
  startBeat: number;
  timeSignature: { count: number; unit: number };
}

interface TimelineTempoChange {
  measure: number;
  playthrough: number;
  /** Beat offset within the measure where the tempo takes effect. */
  beatInMeasure: number;
  startSeconds: number;
  /** Effective quarter-note BPM. */
  bpm: number;
}

export function getScoreTimeline(score: Score, args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  const globalCount = score.global.measures.length;
  const { startMeasure, endMeasure } = resolveMeasureRange(score, input, globalCount, MAX_TIMELINE_MEASURES);

  const timeline = generateTimeline(score);
  const measureOrder = timeline.expandedMeasureToOriginal;
  const playthroughByGlobal = new Map<number, number>();
  const inRange = (globalIdx: number): boolean => globalIdx + 1 >= startMeasure && globalIdx + 1 <= endMeasure;

  const measures: TimelineMeasureEntry[] = [];
  for (let i = 0; i < measureOrder.length; i++) {
    const globalIdx = measureOrder[i]!;
    const playthrough = playthroughByGlobal.get(globalIdx) ?? 0;
    playthroughByGlobal.set(globalIdx, playthrough + 1);
    if (!inRange(globalIdx)) continue;
    const startSeconds = timeline.measureStartTimes[i] ?? 0;
    const endSeconds =
      i + 1 < timeline.measureStartTimes.length ? timeline.measureStartTimes[i + 1]! : timeline.duration;
    measures.push({
      measure: globalIdx + 1,
      ...measureReference(score, globalIdx),
      playthrough,
      startSeconds,
      endSeconds,
      startBeat: timeline.measureStartBeats[i] ?? 0,
      timeSignature: timeline.measureTimeSignatures[i] ?? { count: 4, unit: 4 },
    });
  }

  const tempoChanges: TimelineTempoChange[] = [];
  for (const entry of timeline.tempoMap) {
    const globalIdx = measureOrder[entry.measureIndex];
    if (globalIdx === undefined || !inRange(globalIdx)) continue;
    tempoChanges.push({
      measure: globalIdx + 1,
      playthrough: playthroughForExpanded(measureOrder, entry.measureIndex),
      beatInMeasure: entry.beatInMeasure,
      startSeconds: entry.timeSeconds,
      bpm: entry.bpm,
    });
  }

  return {
    startMeasure,
    endMeasure,
    globalMeasureCount: globalCount,
    expandedMeasureCount: measureOrder.length,
    totalDurationSeconds: timeline.duration,
    measures,
    tempoChanges,
  };
}

export function getScoreVideoSync(score: Score): Record<string, unknown> {
  return { videoSync: score.videoSync ?? null };
}

interface Section {
  name: string | null;
  startMeasure: number;
  endMeasure: number;
}

export function getSectionTimings(score: Score, args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  if (score.global.measures.length === 0) throw new Error("The score has no measures.");
  const sections = readSections(score, input.sections);
  const { offset, limit } = pagination(input.offset, input.limit, 100);
  const timeline = generateTimeline(score);
  return {
    totalDurationSeconds: timeline.duration,
    totalSections: sections.length,
    offset,
    nextOffset: offset + limit < sections.length ? offset + limit : null,
    sections: sections.slice(offset, offset + limit).map((section) => {
      const occurrences: { startSeconds: number; endSeconds: number }[] = [];
      let previous = -2;
      timeline.expandedMeasureToOriginal.forEach((index, expandedIndex) => {
        const inRange = index + 1 >= section.startMeasure && index + 1 <= section.endMeasure;
        if (!inRange) {
          previous = -2;
          return;
        }
        const startSeconds = timeline.measureStartTimes[expandedIndex]!;
        const endSeconds = timeline.measureStartTimes[expandedIndex + 1] ?? timeline.duration;
        const last = occurrences.at(-1);
        if (last && index === previous + 1) last.endSeconds = endSeconds;
        else occurrences.push({ startSeconds, endSeconds });
        previous = index;
      });
      return {
        name: section.name,
        start: measureReference(score, section.startMeasure - 1),
        end: measureReference(score, section.endMeasure - 1),
        performedDurationSeconds: occurrences.reduce((total, span) => total + span.endSeconds - span.startSeconds, 0),
        occurrenceCount: occurrences.length,
        occurrences: occurrences.slice(0, 32),
        occurrencesTruncated: occurrences.length > 32,
      };
    }),
  };
}

function readSections(score: Score, value: unknown): Section[] {
  if (value === undefined) {
    const starts = score.global.measures.flatMap((measure, index) =>
      index === 0 || measure.rehearsalMark
        ? [{ index, name: measure.rehearsalMark ? plainTextContent(measure.rehearsalMark.text) : null }]
        : [],
    );
    return starts.map((start, index) => ({
      name: start.name,
      startMeasure: start.index + 1,
      endMeasure: starts[index + 1]?.index ?? score.global.measures.length,
    }));
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("sections must contain 1 to 100 measure ranges.");
  }
  return value.map((section: unknown) => {
    if (!isObject(section)) throw new Error("Each section must be an object.");
    if (section.name !== undefined && typeof section.name !== "string")
      throw new Error("Section name must be a string.");
    if (
      (section.startMeasure === undefined && section.startMeasureId === undefined) ||
      (section.endMeasure === undefined && section.endMeasureId === undefined)
    ) {
      throw new Error("Each section requires start and end measure boundaries.");
    }
    return {
      name: typeof section.name === "string" ? section.name : null,
      ...resolveMeasureRange(score, section, score.global.measures.length),
    };
  });
}

/** Count how many earlier expanded slots map to the same global measure. */
function playthroughForExpanded(measureOrder: readonly number[], expandedIdx: number): number {
  const globalIdx = measureOrder[expandedIdx];
  let count = 0;
  for (let i = 0; i < expandedIdx; i++) {
    if (measureOrder[i] === globalIdx) count++;
  }
  return count;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

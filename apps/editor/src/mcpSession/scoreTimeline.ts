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

import type { Score } from "@viritura/core";
import { expandMeasureOrder, generateTimeline } from "@viritura/midi";

/** Largest measure window a single `get_timeline` call may return. */
const MAX_TIMELINE_MEASURES = 512;

interface TimelineMeasureEntry {
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
  const globalCount = score.global.measures.length;
  if (globalCount === 0) throw new Error("The score has no measures.");
  const input = isObject(args) ? args : {};
  const startMeasure = readMeasureNumber(input.startMeasure, 1, globalCount);
  const endMeasure = readMeasureNumber(input.endMeasure, globalCount, globalCount);
  if (endMeasure < startMeasure) throw new Error("endMeasure must be greater than or equal to startMeasure.");
  if (endMeasure - startMeasure + 1 > MAX_TIMELINE_MEASURES) {
    throw new Error(`A get_timeline call may span at most ${MAX_TIMELINE_MEASURES} measures.`);
  }

  const timeline = generateTimeline(score);
  const measureOrder = expandMeasureOrder(score.global.measures);
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

/** Count how many earlier expanded slots map to the same global measure. */
function playthroughForExpanded(measureOrder: readonly number[], expandedIdx: number): number {
  const globalIdx = measureOrder[expandedIdx];
  let count = 0;
  for (let i = 0; i < expandedIdx; i++) {
    if (measureOrder[i] === globalIdx) count++;
  }
  return count;
}

function readMeasureNumber(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`Measure numbers must be integers from 1 to ${maximum}.`);
  }
  return value as number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

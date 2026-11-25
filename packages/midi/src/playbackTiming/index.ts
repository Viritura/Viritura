import type { Score } from "@viritura/core";
import { playbackGlobalMeasures } from "../cadenzaTiming";
import { buildHoldSchedule } from "../holds";
import { expandScoreMeasureRepeats } from "../measureRepeats";
import { realizeNavigation } from "../navigation";
import { buildPlaybackTempoModel } from "../playbackTempo";
import { scorePlaybackItinerary } from "../repeatExpansion";
import { resolveActiveTime } from "../staffMeterTiming";
import { tempoMapEntries } from "../tempoMap";
import type { MidiTimeline } from "../types";

export type PlaybackTiming = Omit<MidiTimeline, "events" | "diagnostics">;

/** Compile only musical timing; never realize instrument notes, dynamics, or samplers. */
export function compilePlaybackTiming(input: Score): PlaybackTiming {
  const score = expandScoreMeasureRepeats(input);
  if (score.global.measures.length === 0) throw new Error("The MNX file has no measures");
  const spans = scorePlaybackItinerary(score);
  if (spans.length === 0) throw new Error("The MNX file has no playable measures");
  const measureOrder = spans.map((span) => span.measureIndex);
  const expandedGlobal = playbackGlobalMeasures(score, measureOrder);
  const holds = buildHoldSchedule(score, measureOrder, score.global.measures);
  const timing = buildPlaybackTempoModel(score, measureOrder, holds);
  const timeline: MidiTimeline = {
    fermataHolds: holds.flatMap((row, index) =>
      row
        .filter((hold) => hold.kind === "fermata")
        .map((hold) => ({
          beat: timing.measureStartBeats[index]! + hold.atBeat,
          clickBehavior: hold.clickBehavior ?? "silent",
        })),
    ),
    ...timing,
    duration: timing.model.timeAtBeat(timing.totalBeats),
    events: [],
    tempoMap: tempoMapEntries(expandedGlobal, timing),
    expandedMeasureToOriginal: measureOrder,
    measureTimeSignatures: measureOrder.map((index) => resolveActiveTime(score.global.measures, index)),
    playedSpans: spans,
  };
  // The navigation realizer also slices the tempo model at partial-bar jumps.
  const realized =
    score.global.measures.some((measure) => measure.jump !== undefined) ||
    spans.some((span) => span.startBeat > 0 || span.endBeat < span.measureBeats)
      ? realizeNavigation(timeline, spans)
      : timeline;
  const { events: _events, diagnostics: _diagnostics, ...result } = realized;
  return result;
}

import type { ClickEvent } from "@viritura/audio";
import type { MidiTimeline } from "@viritura/midi";
import { buildClickSessionProgram, type ClickSessionSource } from "./clickSession";

/** Options for {@link buildClickTrack}. */
export interface ClickTrackOptions {
  /**
   * Prepend one full bar in the opening meter and tempo, using the same beat
   * groups and subdivision as Click mode. Count-in times are negative.
   */
  countIn?: boolean;
}

/**
 * Seconds the count-in occupies before score time 0, i.e. the negative score
 * time playback must start from for the count-in to be heard. Uses the opening
 * tempo (seconds per quarter at beat 0).
 */
export function countInLeadSeconds(timeline: Pick<MidiTimeline, "model" | "measureTimeSignatures">): number {
  const meter = timeline.measureTimeSignatures[0];
  if (!meter) return 0;
  return ((meter.count * 4) / meter.unit) * timeline.model.spbAtBeat(0);
}

/**
 * Adapt the shared Click compiler to score time. The score transport schedules
 * the same accent/beat/subdivision events as the isolated recording engine;
 * only the count-in's time origin differs.
 */
export function buildClickTrack(timeline: ClickSessionSource, options?: ClickTrackOptions): ClickEvent[] {
  if (timeline.measureStartBeats.length === 0) return [];
  const program = buildClickSessionProgram(timeline, {
    startTimelineMeasure: 0,
    countoff: options?.countIn ?? false,
  });
  return program.events.map((event) => ({ ...event, time: event.time - program.countoffSeconds }));
}

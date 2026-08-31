import { Metronome, type ClickEvent } from "@viritura/audio";
import type { MidiTimeline } from "@viritura/midi";

/** The tempo/meter structure needed to lay out a metronome click track. */
type ClickTrackSource = Pick<MidiTimeline, "model" | "measureStartBeats" | "measureTimeSignatures">;

/** Options for {@link buildClickTrack}. */
export interface ClickTrackOptions {
  /**
   * Number of count-in beats clicked before the music (at negative score time).
   * The first count-in click is accented; the rest are not. Each beat lasts one
   * quarter-note at the opening tempo, so the final count-in click lands one
   * beat before the downbeat (score time 0). Default 0 (no count-in).
   */
  countInBeats?: number;
}

/**
 * Seconds the count-in occupies before score time 0, i.e. the negative score
 * time playback must start from for the count-in to be heard. Uses the opening
 * tempo (seconds per quarter at beat 0).
 */
export function countInLeadSeconds(timeline: Pick<MidiTimeline, "model">, countInBeats: number): number {
  if (countInBeats <= 0) return 0;
  return countInBeats * timeline.model.spbAtBeat(0);
}

/**
 * Build a sample-accurate metronome click track (score times) from a generated
 * timeline. For each expanded measure, {@link Metronome.getBeatsForMeasure}
 * yields the click grid (one click per beat in simple meters, dotted-quarter
 * groupings in compound meters, accent on the downbeat); each beat position
 * (in time-signature denominator units) is converted to a global quarter-note
 * beat and timed through the tempo model so clicks track sub-bar tempo changes,
 * rit./accel., and fermata holds.
 *
 * When `countInBeats > 0`, that many quarter-note clicks are prepended at
 * negative score times (the first accented) so a transport starting at
 * `-countInLeadSeconds` plays a count-in into the downbeat.
 *
 * The result is sorted ascending in time (count-in is negative and ascending;
 * measures and within-measure positions are both ascending), matching the
 * Scheduler's binary-search expectation.
 */
export function buildClickTrack(timeline: ClickTrackSource, options?: ClickTrackOptions): ClickEvent[] {
  const { model, measureStartBeats, measureTimeSignatures } = timeline;
  const clicks: ClickEvent[] = [];

  // Count-in: N quarter-note clicks before t=0 at the opening tempo.
  const countInBeats = options?.countInBeats ?? 0;
  if (countInBeats > 0) {
    const spb = model.spbAtBeat(0);
    for (let k = 0; k < countInBeats; k++) {
      clicks.push({ time: -(countInBeats - k) * spb, accented: k === 0 });
    }
  }

  for (let i = 0; i < measureStartBeats.length; i++) {
    const startBeat = measureStartBeats[i];
    const ts = measureTimeSignatures[i];
    if (startBeat === undefined || !ts) continue;

    for (const beat of Metronome.getBeatsForMeasure(ts.count, ts.unit)) {
      // beat.position is in time-signature denominator units; the model's beat
      // axis is quarter notes, so scale by (4 / unit).
      const globalBeat = startBeat + beat.position * (4 / ts.unit);
      clicks.push({ time: model.timeAtBeat(globalBeat), accented: beat.accented });
    }
  }

  return clicks;
}

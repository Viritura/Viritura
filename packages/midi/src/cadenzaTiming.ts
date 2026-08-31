import {
  DURATION_BEATS,
  type GlobalMeasure,
  type Score,
  type SequenceContent,
  type TimeSignature,
} from "@viritura/core";
import type { HoldSchedule } from "./holds";

type PlaybackGlobalMeasure = GlobalMeasure & { __playbackNominalTime?: TimeSignature };

function contentBeats(content: readonly SequenceContent[]): number {
  let beats = 0;
  for (const item of content) {
    switch (item.type) {
      case "event":
        beats += durationBeats(item.duration.base, item.duration.dots);
        break;
      case "space":
        beats += (item.duration[0] / item.duration[1]) * 4;
        break;
      case "tuplet":
      case "tremolo":
        beats += durationBeats(item.outer.duration.base, item.outer.duration.dots) * item.outer.multiple;
        break;
      case "grace":
        break;
    }
  }
  return beats;
}

function durationBeats(base: keyof typeof DURATION_BEATS, dots?: number): number {
  const beats = DURATION_BEATS[base];
  return dots ? beats * (2 - Math.pow(2, -dots)) : beats;
}

function writtenMeasureBeats(score: Score, measureIndex: number, minimumBeats: number): number {
  return score.parts.reduce((maxBeats, part) => {
    const measure = part.measures[measureIndex];
    if (!measure) return maxBeats;
    return Math.max(
      maxBeats,
      ...measure.sequences
        .filter((sequence) => !sequence.fullMeasure)
        .map((sequence) => contentBeats(sequence.content)),
    );
  }, minimumBeats);
}

/**
 * Playback-only global measures for pickups and open-meter cadenzas. The
 * displayed time signature remains untouched; timing spans the longest written
 * sequence so every part advances together when the shortened measure ends.
 */
export function playbackGlobalMeasures(score: Score, measureOrder: readonly number[]): GlobalMeasure[] {
  let activeBeats = 4;
  return measureOrder.map((measureIndex) => {
    const measure = score.global.measures[measureIndex]!;
    if (measure.time) activeBeats = (measure.time.count * 4) / measure.time.unit;
    if (measureIndex === 0 && measure.number === 0) {
      const pickupBeats = writtenMeasureBeats(score, measureIndex, 0);
      if (pickupBeats > 0) {
        return {
          ...measure,
          __playbackNominalTime: measure.time ? { ...measure.time } : undefined,
          time: {
            ...measure.time,
            count: pickupBeats,
            unit: 4,
          },
        } as PlaybackGlobalMeasure;
      }
    }
    if (measure.time?.display !== "senzaMisura") return measure;

    const cadenzaBeats = writtenMeasureBeats(score, measureIndex, activeBeats);
    return {
      ...measure,
      time: {
        ...measure.time,
        count: cadenzaBeats,
        unit: 4,
      },
    };
  });
}

/** Visual fermatas in an open-meter cadenza do not introduce a second delay. */
export function suppressCadenzaFermataHolds(measures: readonly GlobalMeasure[], holds: HoldSchedule): HoldSchedule {
  return holds.map((measureHolds, index) =>
    measures[index]?.time?.display === "senzaMisura"
      ? measureHolds.filter((hold) => hold.kind !== "fermata")
      : [...measureHolds],
  );
}

import type { Score } from "@viritura/core";
import { playbackGlobalMeasures } from "../cadenzaTiming";
import type { HoldSchedule } from "../holds";
import { buildTempoModel, type TempoBuild } from "../tempoMap";
import { TempoModel, type TempoInsertion } from "../tempoModel";

/** Resolve musical ramps once, then realize their source intervals in playback order. */
export function buildPlaybackTempoModel(
  score: Score,
  measureOrder: readonly number[],
  holds: HoldSchedule,
): TempoBuild {
  const source = buildTempoModel(
    playbackGlobalMeasures(
      score,
      score.global.measures.map((_, index) => index),
    ),
  );
  const intervals = measureOrder.map((index) => ({
    startBeat: source.measureStartBeats[index]!,
    endBeat: source.measureStartBeats[index + 1] ?? source.totalBeats,
  }));
  const realized = TempoModel.concatenate(source.model, intervals);
  const measureStartBeats: number[] = [];
  const insertions: TempoInsertion[] = [];
  let totalBeats = 0;
  intervals.forEach((interval, index) => {
    measureStartBeats.push(totalBeats);
    const spb = realized.spbAtBeat(totalBeats);
    for (const hold of holds[index] ?? []) {
      insertions.push({ beat: totalBeats + hold.atBeat, seconds: hold.extraBeats * spb });
    }
    totalBeats += interval.endBeat - interval.startBeat;
  });
  const model = realized.withInsertions(insertions);
  return {
    model,
    measureStartBeats,
    measureStartTimes: measureStartBeats.map((beat) => model.timeAtBeat(beat)),
    totalBeats,
  };
}

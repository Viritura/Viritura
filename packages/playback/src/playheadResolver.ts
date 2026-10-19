import type { PlayheadResolver } from "@viritura/audio";
import type { MidiTimeline } from "@viritura/midi";

type PlayheadTimeline = Pick<MidiTimeline, "model" | "measureStartBeats" | "expandedMeasureToOriginal" | "playedSpans">;

/**
 * Resolve a position in the authored score to its first performed occurrence.
 * Measures after a repeat have a larger expanded index than their source index.
 */
export function sourceMeasureBeatToSeconds(
  timeline: PlayheadTimeline,
  sourceMeasureIndex: number,
  beat: number,
): number | null {
  const expandedIndex = timeline.expandedMeasureToOriginal.findIndex(
    (originalIndex, index) =>
      originalIndex === sourceMeasureIndex &&
      (timeline.playedSpans?.[index] === undefined ||
        (beat >= timeline.playedSpans[index]!.startBeat && beat < timeline.playedSpans[index]!.endBeat)),
  );
  if (expandedIndex < 0 && timeline.playedSpans) return null;
  const resolvedIndex = expandedIndex >= 0 ? expandedIndex : sourceMeasureIndex;
  const startBeat = timeline.measureStartBeats[resolvedIndex];
  return startBeat === undefined
    ? null
    : timeline.model.timeAtBeat(startBeat + beat - (timeline.playedSpans?.[resolvedIndex]?.startBeat ?? 0));
}

export function createPlayheadResolver(timeline: PlayheadTimeline): PlayheadResolver {
  const { model, measureStartBeats, expandedMeasureToOriginal } = timeline;

  return (scoreTime: number) => {
    const globalBeat = model.beatAtTime(scoreTime);
    let expandedMeasureIndex = 0;
    for (let i = 0; i < measureStartBeats.length; i++) {
      if (measureStartBeats[i]! <= globalBeat + 1e-9) expandedMeasureIndex = i;
      else break;
    }

    return {
      measureIndex: expandedMeasureToOriginal[expandedMeasureIndex] ?? expandedMeasureIndex,
      beat:
        globalBeat -
        (measureStartBeats[expandedMeasureIndex] ?? 0) +
        (timeline.playedSpans?.[expandedMeasureIndex]?.startBeat ?? 0),
    };
  };
}

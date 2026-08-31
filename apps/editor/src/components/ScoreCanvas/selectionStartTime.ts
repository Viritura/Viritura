import type { Score, Tuplet } from "@viritura/core";
import { resolveEventLocation } from "../../score/ElementPath";
import { durationToBeats } from "../../commands/noteCommands";

interface PlaybackActionsLike {
  measureBeatToSeconds: (measureIndex: number, beat: number) => number | null;
}

interface SelectionLike {
  kind: string;
  elementId?: string;
}

/**
 * Compute the playback start time (seconds) for the current selection, or
 * `undefined` if the selection doesn't pinpoint an event.
 */
export function computeSelectionStartTime(
  sel: SelectionLike,
  score: Score | null,
  acts: PlaybackActionsLike,
): number | undefined {
  if (sel.kind !== "single" || !score || !sel.elementId) return undefined;
  const mMatch = sel.elementId.match(/m(\d+)/);
  if (!mMatch) return undefined;
  const measureIndex = parseInt(mMatch[1]!, 10);
  const loc = resolveEventLocation(sel.elementId, score);
  const beat = loc ? computeBeatOffset(score, loc.partIndex, loc.measureIndex, loc.sequenceIndex, loc.eventIndex) : 0;
  const t = acts.measureBeatToSeconds(measureIndex, beat);
  return t ?? undefined;
}

function computeBeatOffset(
  score: Score,
  partIndex: number,
  measureIndex: number,
  sequenceIndex: number,
  eventIndex: number,
): number {
  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (!seq) return 0;
  let beat = 0;
  let flatIdx = 0;
  for (const item of seq.content) {
    if (flatIdx >= eventIndex) break;
    if (item.type === "tuplet") {
      const innerCount = item.content.filter((c) => c.type === "event").length;
      const remaining = eventIndex - flatIdx;
      if (remaining <= innerCount) {
        beat += beatOffsetWithinTuplet(item, remaining);
        return beat;
      }
      const outerBeats = (item.outer.multiple ?? 1) * durationToBeats(item.outer.duration);
      beat += outerBeats;
      flatIdx += innerCount;
    } else if (item.type === "event") {
      beat += durationToBeats(item.duration);
      flatIdx++;
    }
  }
  return beat;
}

type TupletItem = Tuplet;

function beatOffsetWithinTuplet(item: TupletItem, remaining: number): number {
  const outerBeats = (item.outer.multiple ?? 1) * durationToBeats(item.outer.duration);
  const innerBeats = durationToBeats(item.inner.duration) * item.inner.multiple;
  const scale = innerBeats > 0 ? outerBeats / innerBeats : 1;
  let beat = 0;
  let inner = 0;
  for (const ev of item.content) {
    if (inner >= remaining) break;
    if (ev.type === "event" && ev.duration) {
      beat += durationToBeats(ev.duration) * scale;
      inner++;
    }
  }
  return beat;
}

import {
  isRest,
  remapLyricExtenderTargets,
  remapScoreLyricExtenderTargets,
  type Score,
  type Sequence,
  type TimeSignature,
} from "@viritura/core";
import {
  decomposeDuration,
  decomposeRestsAtPosition,
  durationToBeats,
  generateEventId,
  sequenceContentBeats,
} from "../noteCommandsDurations";

/** Merge metrically compatible rests without removing a later syllable's onset. */
export function mergeAdjacentRests(sequence: Sequence, protectIndex?: number, ts?: TimeSignature, score?: Score): void {
  const targetRemap = new Map<string, string>();
  let i = 0;
  while (i < sequence.content.length - 1) {
    if (protectIndex !== undefined && (i === protectIndex || i + 1 === protectIndex)) {
      i++;
      continue;
    }
    const curr = sequence.content[i]!;
    const next = sequence.content[i + 1]!;
    if (curr.type === "event" && next.type === "event" && isRest(curr) && isRest(next) && !next.lyrics) {
      const totalBeats = durationToBeats(curr.duration) + durationToBeats(next.duration);
      let startBeat = 0;
      for (let j = 0; j < i; j++) startBeat += sequenceContentBeats(sequence.content[j]!);
      const merged = ts ? decomposeRestsAtPosition(totalBeats, startBeat, ts) : decomposeDuration(totalBeats);
      if (merged.length === 1) {
        const joined = { ...curr, id: curr.id ?? generateEventId(), duration: merged[0]! };
        if (next.id) targetRemap.set(next.id, joined.id);
        sequence.content.splice(i, 2, joined);
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  remapLyricExtenderTargets(sequence.content, targetRemap);
  if (score) remapScoreLyricExtenderTargets(score, targetRemap);
}

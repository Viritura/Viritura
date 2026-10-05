import { listInstrumentChanges, type Score } from "@viritura/core";
import { instrumentSamplerKey } from "@viritura/midi";
import type { ISampler } from "@viritura/audio";
import type { SoundProfileRegistry } from "@viritura/sound-profiles";
import { resolveScorePlaybackParts } from "./resolveScorePlaybackParts";
import type { ResolvedPlaybackPart } from "./resolvePartSounds";

export interface PlaybackPreviewPosition {
  /** Written score measure index, not the repeat-expanded timeline index. */
  measureIndex: number;
  fraction?: readonly [number, number];
}

function instrumentKey(score: Score, partIndex: number, position: PlaybackPreviewPosition): string {
  const part = score.parts[partIndex];
  if (!part) return "initial";
  const fraction = position.fraction ?? [0, 1];
  let key = "initial";
  for (const located of listInstrumentChanges(part)) {
    if (located.measureIndex > position.measureIndex) break;
    if (
      located.measureIndex === position.measureIndex &&
      located.position[0] * fraction[1] > fraction[0] * located.position[1]
    )
      break;
    if (located.change.instrument !== undefined) key = `instrument:${located.change.instrument}`;
  }
  return key;
}

export function resolvePreviewSound(
  score: Score,
  partIndex: number,
  position?: PlaybackPreviewPosition,
  registry?: SoundProfileRegistry,
): ResolvedPlaybackPart | undefined {
  const resolved = resolveScorePlaybackParts(score, registry)[partIndex];
  if (!position || !resolved?.instruments) return resolved;
  return resolved.instruments.find(({ key }) => key === instrumentKey(score, partIndex, position))?.resolved;
}

/** Position-addressed previews use the real preloaded timbre, including layers. */
export function previewSampler(
  score: Score | null | undefined,
  partIndex: number | undefined,
  position: PlaybackPreviewPosition | undefined,
  samplers: ReadonlyMap<number, ISampler>,
  routing: ReadonlyMap<number | string, ISampler>,
  timeline: { events: readonly { partIndex: number; playbackLaneId?: string }[] } | null,
): ISampler | undefined {
  const fallback = partIndex === undefined ? samplers.values().next().value : samplers.get(partIndex);
  if (!score || partIndex === undefined || !position) return fallback;
  const part = score.parts[partIndex];
  if (!part || !listInstrumentChanges(part).some(({ change }) => change.instrument !== undefined)) return fallback;
  const lane = timeline?.events.find((event) => event.partIndex === partIndex && event.playbackLaneId)?.playbackLaneId;
  return lane ? routing.get(instrumentSamplerKey(lane, instrumentKey(score, partIndex, position))) : undefined;
}

import type { Score } from "../../model";
import { CHORDS_PART_ID } from "../chordSymbols";

/** Drop deleted references while retaining the derived Chords channel, even when hidden. */
export function pruneMixerSettings(score: Score, groupIds?: readonly string[]): Score {
  const mixer = score.mixer;
  if (!mixer) return score;
  const partIds = new Set(score.parts.flatMap((part) => (part.id ? [part.id] : [])));
  partIds.add(CHORDS_PART_ID);
  const groups = groupIds ? new Set(groupIds) : undefined;
  const pruneChannels = mixer.channels && Object.keys(mixer.channels).some((id) => !partIds.has(id));
  const pruneGroups = mixer.groups && groups && Object.keys(mixer.groups).some((id) => !groups.has(id));
  if (!pruneChannels && !pruneGroups) return score;
  return {
    ...score,
    mixer: {
      ...mixer,
      ...(pruneChannels
        ? { channels: Object.fromEntries(Object.entries(mixer.channels ?? {}).filter(([id]) => partIds.has(id))) }
        : {}),
      ...(pruneGroups
        ? { groups: Object.fromEntries(Object.entries(mixer.groups ?? {}).filter(([id]) => groups.has(id))) }
        : {}),
    },
  };
}

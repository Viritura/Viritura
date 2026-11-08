import { pruneMixerSettings, resolvePartDisplayNames, type Score } from "@viritura/core";
import { extractFamilyGroups } from "./familyGroups";

export function scoreMixerGroups(score: Score) {
  const names = resolvePartDisplayNames(score.parts);
  return extractFamilyGroups(
    score,
    score.parts.map((part, index) => ({
      index,
      name: names[index]?.displayName ?? part.name,
    })),
  );
}

export function reconcileScoreMixer(score: Score): Score {
  return pruneMixerSettings(
    score,
    score.mixer?.groups ? scoreMixerGroups(score).map((group) => group.label) : undefined,
  );
}

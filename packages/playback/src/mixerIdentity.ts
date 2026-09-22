import { CHORDS_PART_ID, type Score } from "@viritura/core";
import { getChordPlaybackPart } from "@viritura/midi";

export function playbackPartIds(score: Score | null | undefined): string[] {
  if (!score) return [];
  return [
    ...score.parts.map((part, index) => part.id ?? `part:${index}`),
    ...(getChordPlaybackPart(score) ? [CHORDS_PART_ID] : []),
  ];
}

/** Numeric routing indices are disposable; retain intent by stable lane identity. */
export function createMixerIdentity() {
  let ids: readonly string[] = [];
  const archives = new Map<Map<number, unknown>, Map<string, unknown>>();
  return (nextIds: readonly string[], maps: readonly Map<number, unknown>[]) => {
    if (ids.length === nextIds.length && ids.every((id, index) => id === nextIds[index])) return;
    for (const map of maps) {
      const saved = archives.get(map) ?? new Map<string, unknown>();
      for (const [index, value] of map) {
        const id = ids[index];
        if (id !== undefined) {
          saved.delete(id);
          saved.set(id, value);
        }
      }
      map.clear();
      const indices = new Map(nextIds.map((id, index) => [id, index]));
      for (const [id, value] of saved) {
        const index = indices.get(id);
        if (index !== undefined) map.set(index, value);
      }
      archives.set(map, saved);
    }
    ids = nextIds;
  };
}

import type { Part, Score } from "@viritura/core";
import { getChordPlaybackPart, playbackInstruments } from "@viritura/midi";
import type { SoundProfileRegistry } from "@viritura/sound-profiles";
import { resolvePartSounds, type ResolvedPlaybackPart } from "./resolvePartSounds";

/** Resolve authored instruments and the runtime-only global harmony lane. */
export function resolveScorePlaybackParts(score: Score, registry?: SoundProfileRegistry): ResolvedPlaybackPart[] {
  const resolved = resolvePartSounds(score.parts, score.soundProfile, registry);
  for (const playbackPart of resolved) {
    const instruments = playbackInstruments(playbackPart.part);
    if (instruments.length === 1) continue;
    // Keep the authored source/VST assignment only for the initial timbre.
    // Explicit changes (even back to the initial instrument) use defaults.
    resolved[playbackPart.index] = {
      ...playbackPart,
      instruments: instruments.map(({ key, part }) => ({
        key,
        resolved:
          key === "initial"
            ? playbackPart
            : { ...resolvePartSounds([part], undefined, registry)[0]!, index: playbackPart.index },
      })),
    };
  }
  const chords = getChordPlaybackPart(score);
  if (!chords) return resolved;

  const part: Part = {
    id: chords.id,
    name: chords.name,
    measures: [],
    _x: { viritura: { instrumentId: "keyboard.piano", midiProgram: 0 } },
  };
  // Global harmony uses the built-in piano, not the score's instrument assignments.
  const [chordSound] = resolvePartSounds([part], undefined, registry);
  resolved.push({ ...chordSound!, index: chords.partIndex });
  return resolved;
}

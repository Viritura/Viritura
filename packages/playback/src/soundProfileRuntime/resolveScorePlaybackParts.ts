import type { Part, Score } from "@viritura/core";
import { getChordPlaybackPart } from "@viritura/midi";
import type { SoundProfileRegistry } from "@viritura/sound-profiles";
import { resolvePartSounds, type ResolvedPlaybackPart } from "./resolvePartSounds";

/** Resolve authored instruments and the runtime-only global harmony lane. */
export function resolveScorePlaybackParts(score: Score, registry?: SoundProfileRegistry): ResolvedPlaybackPart[] {
  const resolved = resolvePartSounds(score.parts, score.soundProfile, registry);
  const chords = getChordPlaybackPart(score);
  if (!chords) return resolved;

  const part: Part = {
    id: chords.id,
    name: chords.name,
    measures: [],
    _x: { viritura: { instrumentId: "piano", midiProgram: 0 } },
  };
  // Global harmony uses the built-in piano, not the score's instrument assignments.
  const [chordSound] = resolvePartSounds([part], undefined, registry);
  resolved.push({ ...chordSound!, index: chords.partIndex });
  return resolved;
}

import type { Score } from "@viritura/core";
import { generateTimeline, writeMidiFile } from "@viritura/midi";
import { requireSf2Sound, resolveScorePlaybackParts } from "./soundProfileRuntime";

export function exportScoreMidi(score: Score): { bytes: Uint8Array; warnings: string[] } {
  const parts = resolveScorePlaybackParts(score).slice(0, score.parts.length);
  const programs = parts.map((part) => requireSf2Sound(part.part.name, part.sf2).primary.program);
  const instrumentPrograms = new Map(
    parts.map((part) => [
      part.index,
      new Map(
        (part.instruments ?? []).map(({ key, resolved }) => [
          key,
          requireSf2Sound(resolved.part.name, resolved.sf2).primary.program,
        ]),
      ),
    ]),
  );
  const timeline = generateTimeline(score, {
    partPrograms: programs,
    instrumentPrograms,
    includeGlobalChords: false,
    humanizeTiming: false,
  });
  const warnings = new Set(timeline.diagnostics?.map((diagnostic) => diagnostic.message));
  const percussionParts = new Set(
    timeline.events.filter((event) => event.type === "noteOn" && event.channel === 9).map((event) => event.partIndex),
  );
  if (percussionParts.size > 1) {
    warnings.add("Percussion parts share MIDI channel 10, so their dynamics may affect each other.");
  }
  if (
    timeline.events.some((event) => event.drumKitProgram !== undefined) ||
    [...percussionParts].some((index) => {
      const sound = parts[index];
      return sound && (requireSf2Sound(sound.part.name, sound.sf2).primary.drumKitProgram ?? 0) !== 0;
    })
  ) {
    warnings.add("Some percussion sounds require alternate drum kits that MIDI export cannot reproduce.");
  }
  return {
    bytes: writeMidiFile(
      timeline,
      score.parts.map((part) => part.name),
      programs,
    ),
    warnings: [...warnings],
  };
}

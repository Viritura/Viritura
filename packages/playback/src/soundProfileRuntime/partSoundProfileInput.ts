import type { Part } from "@viritura/core";
import type { SoundSourceId } from "@viritura/sound-profiles";
import type { ProfileResolveInput } from "@viritura/sound-profiles";

/** Build the stable profile input shared by playback and profile presentation. */
export function partSoundProfileInput(
  part: Part | undefined,
  fallbackLegacyName?: string,
  selectedSourceId?: SoundSourceId,
): ProfileResolveInput {
  return {
    instrumentId: part?._x?.viritura?.instrumentId,
    partId: part?.id,
    selectedSourceId,
    legacyName: part?.name ?? fallbackLegacyName,
    explicitMidiProgram: part?._x?.viritura?.midiProgram,
    hasKit: Object.keys(part?.kit ?? {}).length > 0,
  };
}

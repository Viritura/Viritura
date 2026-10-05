import { initialInstrumentState, type Part } from "@viritura/core";
import type { SoundSourceId } from "@viritura/sound-profiles";
import type { ProfileResolveInput } from "@viritura/sound-profiles";

/** Build the stable profile input shared by playback and profile presentation. */
export function partSoundProfileInput(
  part: Part | undefined,
  fallbackLegacyName?: string,
  selectedSourceId?: SoundSourceId,
): ProfileResolveInput {
  const instrument = part ? initialInstrumentState(part).instrument : undefined;
  return {
    instrumentId: instrument?.instrumentId ?? part?._x?.viritura?.instrumentId,
    partId: part?.id,
    selectedSourceId,
    legacyName: instrument?.name ?? part?.name ?? fallbackLegacyName,
    explicitMidiProgram: instrument ? instrument.midiProgram : part?._x?.viritura?.midiProgram,
    hasKit: Object.keys(part?.kit ?? {}).length > 0,
  };
}

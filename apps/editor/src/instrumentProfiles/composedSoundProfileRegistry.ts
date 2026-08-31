import { useEffect, useMemo } from "react";
import { createVstInstrumentProfile } from "@viritura/instrument-profiles";
import { createSoundProfileRegistry, virituraSoundsProfile, type SoundProfileRegistry } from "@viritura/sound-profiles";
import { loadInstrumentProfiles, useInstrumentProfileStore } from "./instrumentProfileStore";
import { orderSlotsByScoreOrder } from "./profileSections";

/**
 * The sound-profile registry the Mixer picker and playback resolver use: the
 * built-in VirituraSounds profile composed with the user's configured VST
 * instrument profiles. Loads the persisted profiles on first use so a profile
 * is selectable in the Mixer without opening Settings first.
 */
export function useComposedSoundProfileRegistry(): SoundProfileRegistry {
  const profiles = useInstrumentProfileStore((state) => state.profiles);
  const loaded = useInstrumentProfileStore((state) => state.loaded);

  useEffect(() => {
    if (!loaded) void loadInstrumentProfiles();
  }, [loaded]);

  return useMemo(
    () =>
      createSoundProfileRegistry([
        virituraSoundsProfile,
        ...profiles.map((profile) =>
          createVstInstrumentProfile({ ...profile, slots: orderSlotsByScoreOrder(profile.slots) }),
        ),
      ]),
    [profiles],
  );
}

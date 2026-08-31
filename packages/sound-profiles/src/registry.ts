import type { SoundProfile, SoundProfileRegistry } from "./types";

/** Create an immutable, pure lookup registry for a set of profiles. */
export function createSoundProfileRegistry(profiles: readonly SoundProfile[]): SoundProfileRegistry {
  const profilesById = new Map<string, SoundProfile>();
  for (const profile of profiles) {
    if (profilesById.has(profile.id)) {
      throw new Error(`Duplicate sound profile ID: ${profile.id}`);
    }
    profilesById.set(profile.id, profile);
  }

  return {
    get(profileId: string): SoundProfile | undefined {
      return profilesById.get(profileId);
    },
    list(): readonly SoundProfile[] {
      return profiles;
    },
  };
}

import type { PartSoundOverride, Score } from "@viritura/core";

export interface PartSoundSourceChange {
  readonly partId: string;
  readonly sourceId?: string;
  readonly profileId: string;
  readonly profileVersion: number;
}

/**
 * Rebuild the per-part override map against a fixed assignment-level profile.
 * An override only carries an explicit per-part `profileId` when it differs from
 * the assignment-level profile — so switching one part to a different profile
 * never orphans the others (Bug 2), while same-profile edits stay minimal.
 */
function stampOverrides(
  existing: Record<string, PartSoundOverride>,
  prevProfileId: string,
  prevProfileVersion: number,
  assignmentProfileId: string,
): Record<string, PartSoundOverride> {
  const parts: Record<string, PartSoundOverride> = {};
  for (const [partId, override] of Object.entries(existing)) {
    const effectiveId = override.profileId ?? prevProfileId;
    const effectiveVersion = override.profileVersion ?? prevProfileVersion;
    parts[partId] =
      effectiveId === assignmentProfileId
        ? { sourceId: override.sourceId }
        : { sourceId: override.sourceId, profileId: effectiveId, profileVersion: effectiveVersion };
  }
  return parts;
}

/** Return a score with one stable-part-ID sound source assignment changed. */
export function updatePartSoundSource(score: Score, change: PartSoundSourceChange): Score {
  const prev = score.soundProfile;
  const prevProfileId = prev?.profileId ?? change.profileId;
  const prevProfileVersion = prev?.profileVersion ?? change.profileVersion;

  if (change.sourceId) {
    // The edited part defines the new assignment-level profile; existing parts
    // targeting a different profile keep an explicit per-part profileId.
    const parts = stampOverrides(prev?.parts ?? {}, prevProfileId, prevProfileVersion, change.profileId);
    parts[change.partId] = { sourceId: change.sourceId };
    return {
      ...score,
      soundProfile: {
        profileId: change.profileId,
        profileVersion: change.profileVersion,
        parts,
      },
    };
  }

  // Reset this part to its notation-derived VirituraSounds default: drop its
  // override but preserve the assignment-level profile so any remaining parts
  // (which may target a different profile) keep resolving correctly.
  const remaining = { ...(prev?.parts ?? {}) };
  delete remaining[change.partId];
  if (Object.keys(remaining).length === 0) {
    const { soundProfile: _soundProfile, ...withoutSoundProfile } = score;
    return withoutSoundProfile;
  }
  const parts = stampOverrides(remaining, prevProfileId, prevProfileVersion, prevProfileId);
  return {
    ...score,
    soundProfile: {
      profileId: prevProfileId,
      profileVersion: prevProfileVersion,
      parts,
    },
  };
}

/**
 * Reset every part that is NOT on a VirituraSounds instrument (i.e. assigned to
 * a user VST profile) back to its notation-derived VirituraSounds default,
 * returning a new score. Parts already on VirituraSounds — including explicit
 * non-default VirituraSounds source selections — are left untouched.
 *
 * Used when leaving the desktop native VST render mode: VST assignments only
 * play through the native mixer, so switching back to the web SoundFont path
 * should drop them rather than leave the Mixer showing unplayable VST sources.
 * Returns the original score unchanged when nothing targets a VST profile.
 */
export function revertVstAssignmentsToNotationDefault(
  score: Score,
  virituraSoundsProfileId: string,
  virituraSoundsVersion: number,
): Score {
  const prev = score.soundProfile;
  if (!prev) return score;

  const kept: Record<string, PartSoundOverride> = {};
  let changed = prev.profileId !== virituraSoundsProfileId;
  for (const [partId, override] of Object.entries(prev.parts)) {
    const effectiveId = override.profileId ?? prev.profileId;
    if (effectiveId === virituraSoundsProfileId) {
      kept[partId] = { sourceId: override.sourceId };
    } else {
      changed = true;
    }
  }
  if (!changed) return score;

  if (Object.keys(kept).length === 0) {
    const { soundProfile: _soundProfile, ...withoutSoundProfile } = score;
    return withoutSoundProfile;
  }
  return {
    ...score,
    soundProfile: {
      profileId: virituraSoundsProfileId,
      profileVersion: virituraSoundsVersion,
      parts: kept,
    },
  };
}

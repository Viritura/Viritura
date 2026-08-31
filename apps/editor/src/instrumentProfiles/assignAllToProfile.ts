/**
 * assignAllToProfile — bulk-assign every score part to its matching configured
 * slot in a chosen VST instrument profile.
 *
 * Matching is best-effort, in priority order:
 *   1. Exact catalog-instrument match (a slot created from the same catalog
 *      instrument as the part). Multiple same-instrument parts round-robin
 *      across multiple matching slots (e.g. Violins I / Violins II).
 *   2. Section match — any configured slot in the part's orchestral section,
 *      round-robined. This covers profiles whose slots share a section but were
 *      authored as custom (no catalog identity).
 *
 * Parts with no match are left unassigned (they resolve to the VirituraSounds
 * notation default). Each assigned override carries the profile's own
 * profileId/version (per-part profiles), so tweaking one part afterward never
 * orphans the rest.
 */

import type { PartSoundOverride, Score } from "@viritura/core";
import type { OrchestraSection, ProfileSlot, VstInstrumentProfile } from "@viritura/instrument-profiles";
import { isSlotFullyConfigured } from "@viritura/instrument-profiles";
import { getCatalogInstrument } from "../score/InstrumentCatalog";
import { sectionForFamily } from "./profileSections";

function pushInto<K>(map: Map<K, ProfileSlot[]>, key: K, slot: ProfileSlot): void {
  const existing = map.get(key);
  if (existing) existing.push(slot);
  else map.set(key, [slot]);
}

/** Round-robin the next slot for a key, advancing the per-key cursor. */
function nextSlot<K>(slotsByKey: Map<K, ProfileSlot[]>, cursors: Map<K, number>, key: K): ProfileSlot | undefined {
  const slots = slotsByKey.get(key);
  if (!slots || slots.length === 0) return undefined;
  const i = cursors.get(key) ?? 0;
  cursors.set(key, i + 1);
  return slots[i % slots.length];
}

/** The orchestral section a part belongs to, derived from its catalog identity. */
function sectionForPart(instrumentId: string | undefined): OrchestraSection | undefined {
  if (!instrumentId) return undefined;
  const inst = getCatalogInstrument(instrumentId);
  return inst ? sectionForFamily(inst.family) : undefined;
}

/**
 * Assign every part to its matching configured slot in `profile`, returning a
 * new score. Returns the original score unchanged when the profile has no
 * configured slots or no part matches.
 */
export function assignAllPartsToProfile(score: Score, profile: VstInstrumentProfile): Score {
  const configured = profile.slots.filter((slot) => isSlotFullyConfigured(slot.binding));
  if (configured.length === 0) return score;

  const byInstrument = new Map<string, ProfileSlot[]>();
  const bySection = new Map<OrchestraSection, ProfileSlot[]>();
  for (const slot of configured) {
    if (slot.catalogInstrumentId) pushInto(byInstrument, slot.catalogInstrumentId, slot);
    pushInto(bySection, slot.section, slot);
  }

  const instrumentCursor = new Map<string, number>();
  const sectionCursor = new Map<OrchestraSection, number>();

  const parts: Record<string, PartSoundOverride> = {};
  for (const part of score.parts) {
    if (!part.id) continue;
    const instrumentId = part._x?.viritura?.instrumentId;

    let slot: ProfileSlot | undefined;
    if (instrumentId) slot = nextSlot(byInstrument, instrumentCursor, instrumentId);
    if (!slot) {
      const section = sectionForPart(instrumentId);
      if (section) slot = nextSlot(bySection, sectionCursor, section);
    }
    if (slot) {
      parts[part.id] = { sourceId: slot.slotId, profileId: profile.id, profileVersion: profile.version };
    }
  }

  if (Object.keys(parts).length === 0) return score;
  return {
    ...score,
    soundProfile: { profileId: profile.id, profileVersion: profile.version, parts },
  };
}

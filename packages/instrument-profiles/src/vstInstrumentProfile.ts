import type {
  OrchestraSection,
  PlaybackCapabilities,
  ProfileResolveInput,
  ResolvedPartSound,
  SoundProfile,
  SoundSourceId,
  SourceCatalogEntry,
  VstSoundSourceDefinition,
} from "@viritura/sound-profiles";
import { DEFAULT_LISTENER_POSITION, routingDefaultsFor } from "./routingDefaults";
import { isSlotFullyConfigured } from "./slot";
import type { ProfileSlot, VstInstrumentProfile } from "./types";

/**
 * VST sources are opaque instances driven by a per-slot Lua mapper. Program
 * changes and keyswitches are emitted by the mapper, not the engine, so from the
 * engine's perspective a VST source is a single non-layered channel target.
 */
export const VST_CAPABILITIES: PlaybackCapabilities = {
  sourceKinds: ["vst"],
  supportsLayeredSources: false,
  supportsProgramChange: true,
  supportsFixedMidiNote: false,
};

/** A slot exposed as a selectable Mixer source. */
export interface SlotSourceOption {
  readonly sourceId: SoundSourceId;
  readonly section: OrchestraSection;
  readonly label: string;
  /** Present when the slot derives from a catalog instrument. */
  readonly catalogInstrumentId?: string;
  /** Whether all three configured values are present (i.e. currently playable). */
  readonly configured: boolean;
}

function slotToSource(profileId: string, slot: ProfileSlot): VstSoundSourceDefinition {
  return {
    id: slot.slotId,
    kind: "vst",
    hostProfileId: profileId,
    instrumentSlot: slot.slotId,
    midiChannel: slot.binding.baseChannel,
    articulationMapId: slot.binding.luaScriptPath,
  };
}

/** The slots of a profile as Mixer source options, in section order. */
export function slotSourceOptions(profile: VstInstrumentProfile): readonly SlotSourceOption[] {
  return profile.slots.map((slot) => ({
    sourceId: slot.slotId,
    section: slot.section,
    label: slot.label,
    catalogInstrumentId: slot.catalogInstrumentId,
    configured: isSlotFullyConfigured(slot.binding),
  }));
}

/**
 * Build a pure {@link SoundProfile} from a user-authored VST profile so it plugs
 * into the existing `SoundProfileRegistry` alongside VirituraSounds. Resolution
 * matches the part's **selected source ID** (the slot the user picked in the
 * Mixer), never its notation instrument identity — which is precisely why two
 * violin parts can resolve to two different instances without collision.
 *
 * Returns `null` for an unknown or not-fully-configured slot so the caller falls
 * back to VirituraSounds for that part.
 */
export function createVstInstrumentProfile(profile: VstInstrumentProfile): SoundProfile {
  const slotsById = new Map<string, ProfileSlot>(profile.slots.map((slot) => [slot.slotId, slot]));

  return {
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    defaultListenerPosition: { ...DEFAULT_LISTENER_POSITION },
    resolve(input: ProfileResolveInput): ResolvedPartSound | null {
      if (!input.selectedSourceId) return null;
      const slot = slotsById.get(input.selectedSourceId);
      if (!slot || !isSlotFullyConfigured(slot.binding)) return null;
      return {
        profileId: profile.id,
        profileVersion: profile.version,
        selectedSourceId: slot.slotId,
        instrumentId: input.instrumentId,
        sources: [slotToSource(profile.id, slot)],
        routing: routingDefaultsFor(slot.section),
        capabilities: VST_CAPABILITIES,
        resolution: "selected",
      };
    },
    sourceCatalog(): readonly SourceCatalogEntry[] {
      return slotSourceOptions(profile).map((option) => ({
        sourceId: option.sourceId,
        section: option.section,
        label: option.label,
        configured: option.configured,
      }));
    },
  };
}

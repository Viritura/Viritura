import type { Part, SoundProfileAssignment } from "@viritura/core";
import {
  defaultSoundProfileRegistry,
  VIRITURA_SOUNDS_PROFILE_ID,
  type MidiSoundSourceDefinition,
  type ResolvedPartSound,
  type SoundLayeringDefaults,
  type SoundProfileRegistry,
  type SoundSourceDefinition,
  type VstSoundSourceDefinition,
} from "@viritura/sound-profiles";
import { getOrchestraPosition, getOrchestraPositions, type SpatialPosition } from "@viritura/audio";
import { partSoundProfileInput } from "./partSoundProfileInput";

export interface Sf2Layer {
  readonly source: MidiSoundSourceDefinition;
  readonly defaults: SoundLayeringDefaults["layers"][number];
}

interface SupportedSf2Sound {
  readonly kind: "supported";
  readonly primary: MidiSoundSourceDefinition;
  readonly primaryVolumeRatio: number;
  readonly layers: readonly Sf2Layer[];
}

export interface UnsupportedSf2Sound {
  readonly kind: "unsupported";
  readonly reason: "no-sources" | "unsupported-source-kind" | "invalid-layering";
  readonly sources: readonly SoundSourceDefinition[];
}

type Sf2SoundResolution = SupportedSf2Sound | UnsupportedSf2Sound;

export interface ResolvedPlaybackPart {
  readonly index: number;
  readonly part: Part;
  readonly sound: ResolvedPartSound;
  readonly sf2: Sf2SoundResolution;
  readonly position: SpatialPosition;
  /**
   * Present when the part is assigned to a configured VST slot. Until the VST
   * host is wired into transport (Phase 5b/5c), `sf2` carries the retained
   * SoundFont fallback (§3.8) so the part still sounds.
   */
  readonly vst?: VstSoundSourceDefinition;
}

/** A resolved profile source cannot be played by the current SF2 runtime. */
export class UnsupportedSf2SoundError extends Error {
  readonly resolution: UnsupportedSf2Sound;

  constructor(partName: string, resolution: UnsupportedSf2Sound) {
    super(
      `The selected sound profile source for "${partName}" is not supported by the SF2 runtime (${resolution.reason}).`,
    );
    this.name = "UnsupportedSf2SoundError";
    this.resolution = resolution;
  }
}

/** Return a supported SF2 resolution or explicitly stop unsupported profile sources. */
export function requireSf2Sound(partName: string, resolution: Sf2SoundResolution): SupportedSf2Sound {
  if (resolution.kind === "unsupported") throw new UnsupportedSf2SoundError(partName, resolution);
  return resolution;
}

function explicitSpatialPosition(part: Part): SpatialPosition | undefined {
  const position = part._x?.viritura?.spatial;
  return position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : undefined;
}

function isMidiSource(source: SoundSourceDefinition): source is MidiSoundSourceDefinition {
  return source.kind === "midi";
}

function isVstSource(source: SoundSourceDefinition): source is VstSoundSourceDefinition {
  return source.kind === "vst";
}

function resolveSf2Sound(sound: ResolvedPartSound): Sf2SoundResolution {
  if (sound.sources.length === 0) return { kind: "unsupported", reason: "no-sources", sources: sound.sources };
  const midiSources = sound.sources.filter(isMidiSource);
  if (midiSources.length !== sound.sources.length) {
    return { kind: "unsupported", reason: "unsupported-source-kind", sources: sound.sources };
  }

  const [primary, ...layerSources] = midiSources;
  if (!primary) return { kind: "unsupported", reason: "no-sources", sources: sound.sources };
  const layering = sound.layering;
  if (!layering) {
    return layerSources.length === 0
      ? { kind: "supported", primary, primaryVolumeRatio: 1, layers: [] }
      : { kind: "unsupported", reason: "invalid-layering", sources: sound.sources };
  }
  if (
    layering.layers.length !== layerSources.length ||
    layering.layers.some((defaults, index) => defaults.sourceId !== layerSources[index]!.id)
  ) {
    return { kind: "unsupported", reason: "invalid-layering", sources: sound.sources };
  }

  return {
    kind: "supported",
    primary,
    primaryVolumeRatio: layering.primaryVolumeRatio,
    layers: layerSources.map((source, index) => ({ source, defaults: layering.layers[index]! })),
  };
}

/**
 * Resolve parts through the active sound profile before creating runtime
 * samplers. A part assigned to a configured VST slot is flagged with its `vst`
 * source while retaining a VirituraSounds SoundFont fallback (§3.8); all other
 * parts resolve through VirituraSounds exactly as before. Pass a registry
 * composed with the user's VST instrument profiles to honor VST assignments.
 */
export function resolvePartSounds(
  scoreParts: readonly Part[],
  soundProfile?: SoundProfileAssignment,
  registry: SoundProfileRegistry = defaultSoundProfileRegistry,
): ResolvedPlaybackPart[] {
  const virituraSounds =
    registry.get(VIRITURA_SOUNDS_PROFILE_ID) ?? defaultSoundProfileRegistry.get(VIRITURA_SOUNDS_PROFILE_ID);
  if (!virituraSounds) throw new Error(`Built-in sound profile "${VIRITURA_SOUNDS_PROFILE_ID}" is unavailable.`);

  // A score whose assignment-level profile explicitly targets VirituraSounds
  // keeps the strict version guarantee; a user VST profile that is missing or
  // stale falls back silently to VirituraSounds per part (§3.8) rather than
  // aborting playback. Per-part profile overrides are resolved independently
  // below, so mixing VST-assigned parts with VirituraSounds parts is supported.
  const assignmentTargetsVirituraSounds = !soundProfile || soundProfile.profileId === virituraSounds.id;
  if (assignmentTargetsVirituraSounds && soundProfile && soundProfile.profileVersion !== virituraSounds.version) {
    throw new Error(
      `Sound profile "${soundProfile.profileId}" version ${soundProfile.profileVersion} is unavailable; this runtime supports version ${virituraSounds.version}.`,
    );
  }

  const legacyPositions = getOrchestraPositions(scoreParts.map((part) => part.name));
  return scoreParts.map((part, index) => {
    const override = part.id ? soundProfile?.parts[part.id] : undefined;
    const selectedSourceId = override?.sourceId;
    // Effective profile for this part: its own override profile if present,
    // else the assignment-level profile (back-compat with pre-per-part scores).
    const partProfileId = override?.profileId ?? soundProfile?.profileId;
    const partProfileVersion = override?.profileVersion ?? soundProfile?.profileVersion;
    const partTargetsVirituraSounds = !partProfileId || partProfileId === virituraSounds.id;

    const assignedProfile = !partTargetsVirituraSounds ? registry.get(partProfileId!) : undefined;
    const vstProfile = assignedProfile && assignedProfile.version === partProfileVersion ? assignedProfile : undefined;

    let vst: VstSoundSourceDefinition | undefined;
    if (vstProfile && selectedSourceId) {
      const attempt = vstProfile.resolve(partSoundProfileInput(part, undefined, selectedSourceId));
      vst = attempt?.sources.find(isVstSource);
    }

    // VST-assigned parts use the notation-derived VirituraSounds fallback; parts
    // targeting VirituraSounds honor their part-ID source assignment.
    const vsSelectedSourceId = vst ? undefined : partTargetsVirituraSounds ? selectedSourceId : undefined;
    const sound = virituraSounds.resolve(partSoundProfileInput(part, undefined, vsSelectedSourceId));
    if (!sound) {
      throw new Error(
        `VirituraSounds could not resolve ${vst ? "the fallback" : `selected source "${selectedSourceId}"`} for "${part.name}".`,
      );
    }

    const profilePosition =
      sound.resolution === "selected"
        ? sound.routing.stagePosition
        : {
            x: sound.routing.stagePosition.x + legacyPositions[index]!.x - getOrchestraPosition(part.name).x,
            y: sound.routing.stagePosition.y + legacyPositions[index]!.y - getOrchestraPosition(part.name).y,
          };

    return {
      index,
      part,
      sound,
      sf2: resolveSf2Sound(sound),
      position: explicitSpatialPosition(part) ?? profilePosition,
      ...(vst ? { vst } : {}),
    };
  });
}

/** A stable, profile-defined identifier for a playable source. */
export type SoundSourceId = string;

/** The source implementations the profile domain can describe. */
export type SoundSourceKind = "midi" | "vst";

/** The orchestral routing groups used by the current playback engine. */
export type OrchestraSection = "strings" | "woodwinds" | "brass" | "percussion" | "keys" | "voices" | "other";

/** A two-dimensional concert-hall position in meters. */
export interface SpatialPosition {
  readonly x: number;
  readonly y: number;
}

/** A MIDI/SF2 source definition independent of any audio runtime. */
export interface MidiSoundSourceDefinition {
  readonly id: SoundSourceId;
  readonly kind: "midi";
  /** Zero-based General MIDI program number. */
  readonly program: number;
  /** Optional MIDI bank-select MSB. Percussion kits use 128. */
  readonly bankMsb?: number;
  readonly bankLsb?: number;
  /** Program on the selected percussion bank. */
  readonly drumKitProgram?: number;
  /** A fixed General MIDI percussion key for a single unpitched instrument. */
  readonly fixedMidiNote?: number;
}

/**
 * A logical future VST source. Its fields intentionally identify local profile
 * configuration rather than a plugin binary, path, license, or opaque state.
 */
export interface VstSoundSourceDefinition {
  readonly id: SoundSourceId;
  readonly kind: "vst";
  readonly hostProfileId: string;
  readonly instrumentSlot: string;
  readonly midiChannel: number;
  readonly articulationMapId?: string;
}

/** A source that a sound profile can resolve. */
export type SoundSourceDefinition = MidiSoundSourceDefinition | VstSoundSourceDefinition;

/** The runtime-independent defaults for a resolved part's routing. */
export interface PartRoutingDefaults {
  readonly section: OrchestraSection;
  readonly stagePosition: SpatialPosition;
  readonly projectionRefDistance: number;
}

/** Explicit support flags so playback never assumes all source kinds are alike. */
export interface PlaybackCapabilities {
  readonly sourceKinds: readonly SoundSourceKind[];
  readonly supportsLayeredSources: boolean;
  readonly supportsProgramChange: boolean;
  readonly supportsFixedMidiNote: boolean;
}

/** The gain and stage offsets used when a profile deliberately layers sources. */
export interface SoundLayeringDefaults {
  readonly primaryVolumeRatio: number;
  readonly layers: readonly SoundLayerDefaults[];
}

/** Configuration for one non-primary source in a deliberate layer. */
export interface SoundLayerDefaults {
  readonly sourceId: SoundSourceId;
  readonly volumeRatio: number;
  readonly stageOffset: SpatialPosition;
}

/** Metadata from a part that the pure resolver may need for compatibility. */
export interface ProfileResolveInput {
  /** Stable score-instrument identity. This is the primary lookup key. */
  readonly instrumentId?: string;
  /** Stable MNX part ID, retained for callers that associate results with a part. */
  readonly partId?: string;
  /**
   * An explicit, profile-defined playable source selection. This is distinct
   * from the score's notation instrument identity and is never a MIDI program.
   */
  readonly selectedSourceId?: SoundSourceId;
  /** Legacy display name used only when no canonical identity is available. */
  readonly legacyName?: string;
  /** Existing Viritura MIDI metadata, honored for legacy compatibility. */
  readonly explicitMidiProgram?: number;
  /** Whether a legacy part has an authored drum-kit component map. */
  readonly hasKit?: boolean;
}

/** How the built-in profile selected the result. */
export type SoundResolutionKind = "canonical" | "selected" | "explicit" | "legacy" | "fallback";

/** The concrete result of resolving one part through a profile. */
export interface ResolvedPartSound {
  readonly profileId: string;
  readonly profileVersion: number;
  /** Stable profile-defined playable identity selected for this part. */
  readonly selectedSourceId: SoundSourceId;
  /** The score's notation identity, which remains unchanged by source selection. */
  readonly instrumentId?: string;
  readonly sources: readonly SoundSourceDefinition[];
  readonly routing: PartRoutingDefaults;
  readonly capabilities: PlaybackCapabilities;
  readonly layering?: SoundLayeringDefaults;
  readonly resolution: SoundResolutionKind;
}

/**
 * One user-selectable playable source, grouped by orchestra section for
 * cascading picker presentation. This is the profile-agnostic surface the
 * Mixer's sound picker renders — VirituraSounds derives it from its catalog,
 * a VST profile derives it from its configured slots.
 */
export interface SourceCatalogEntry {
  readonly sourceId: SoundSourceId;
  readonly section: OrchestraSection;
  readonly label: string;
  /**
   * False when the source exists but is not yet fully playable (e.g. a VST slot
   * missing its plugin/script/state). Absent means unconditionally playable.
   */
  readonly configured?: boolean;
}

/** A pure, named collection of sound-resolution rules. */
export interface SoundProfile {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly defaultListenerPosition: SpatialPosition;
  resolve(input: ProfileResolveInput): ResolvedPartSound | null;
  /**
   * The profile's user-selectable sources for the Mixer picker, in section
   * order. A profile that omits this is not presented as a selectable pack.
   */
  sourceCatalog?(): readonly SourceCatalogEntry[];
}

/** Lookup surface for available sound profiles. */
export interface SoundProfileRegistry {
  get(profileId: string): SoundProfile | undefined;
  list(): readonly SoundProfile[];
}

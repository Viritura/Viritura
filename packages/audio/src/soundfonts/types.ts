/**
 * Types for SoundFont capability manifests.
 *
 * A manifest declares what a single SoundFont can play so playback (and the
 * editor's drum-kit mapping UI) can resolve a notated percussion hit to a real
 * sample WITHOUT assuming an ambient kit. Mirrors the JSON Schema at
 * `./sf2-capabilities.schema.json`. See that file for the full prose.
 *
 * Three layers:
 *   1. raw capability — every preset + per-key drum sample that actually exists
 *      ({@link DrumKitCapability}, {@link MelodicPresetCapability})
 *   2. semantic resolution — canonical drum identities mapped to the best
 *      `(kit, key)` address in THIS font ({@link PercussionSemantic})
 *   3. known collisions — places the naive GM key map lies for this font
 *      ({@link KnownCollision})
 */

/** Metadata identifying the SoundFont this manifest describes. */
export interface SoundfontInfo {
  /** Stable kebab-case identifier, e.g. `shan-sgm-pro-15`. */
  readonly id: string;
  /** Human-readable font name. */
  readonly name: string;
  /** Font version string, e.g. `15`. */
  readonly version?: string;
  /** Filename in `packages/audio/assets/sounds/`. */
  readonly file: string;
  readonly format?: "sf2" | "sf3";
  /** Sound-set standard, e.g. `GM`, `GM/GS`, `XG`. */
  readonly standard?: string;
  readonly approxSizeMb?: number;
  readonly generatedFrom?: string;
}

/** Which bank numbers carry melodic vs. percussion presets. */
export interface BankLayout {
  /** Bank numbers containing pitched/melodic presets. */
  readonly melodic: readonly number[];
  /** Bank reserved for drum kits (128 in GS-style fonts). */
  readonly percussion: number;
}

/** One mapped key within a drum kit (the raw capability). */
export interface DrumKeyCapability {
  /** Sample name backing this key (from the SF2 SHDR chunk). */
  readonly sample: string;
  /** GM Level-1 percussion name, when the key is in the standard GM map. */
  readonly gm?: string;
}

/** A complete drum-kit preset with its per-key sample map. */
export interface DrumKitCapability {
  /** Program (patch) number within the percussion bank. */
  readonly program: number;
  /** Kit name from the SF2 preset header (e.g. `Standard`, `Orchestra`). */
  readonly name: string;
  readonly keyCount?: number;
  /** MIDI key number (as string) → the sample that sounds on that key. */
  readonly keys: Readonly<Record<string, DrumKeyCapability>>;
}

/** A pitched preset (raw melodic capability). */
export interface MelodicPresetCapability {
  readonly bank: number;
  readonly program: number;
  readonly name: string;
}

/** The concrete address that realizes a semantic identity in one kit. */
export interface SemanticResolution {
  /** MIDI key to actually send. */
  readonly key: number;
  /** Verified sample name at this `(kit, key)`. */
  readonly sample: string;
  /** If set, route to a dedicated channel loaded with THIS kit program instead
   *  of the part's main kit (the `drumKit` kit-component override). */
  readonly borrowKit?: number;
  /** Why this address differs from the naive GM key. */
  readonly reason?: string;
}

/** A canonical drum identity resolved to the best address in this font. */
export interface PercussionSemantic {
  /** Portable GM Level-1 key — what a score writes by default. */
  readonly gmKey: number;
  readonly description?: string;
  /** kit-program (as string) → the address that realizes this identity. */
  readonly resolution: Readonly<Record<string, SemanticResolution>>;
  /** Other semantic ids to try if no `resolution` entry matches the kit. */
  readonly fallback?: readonly string[];
}

/** A documented place where the GM key map is misleading for this font. */
export interface KnownCollision {
  readonly kit: number;
  readonly key: number;
  readonly expectedGm: string;
  readonly actualSample: string;
  readonly workaround?: string;
}

/** A full SoundFont capability manifest. */
export interface Sf2Capabilities {
  readonly soundfont: SoundfontInfo;
  readonly banks: BankLayout;
  readonly drumKits: readonly DrumKitCapability[];
  readonly melodicPresets?: readonly MelodicPresetCapability[];
  readonly percussionSemantics?: Readonly<Record<string, PercussionSemantic>>;
  readonly knownCollisions?: readonly KnownCollision[];
}

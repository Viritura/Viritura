/**
 * @viritura/audio — SF2 sampler engine and playback scheduler.
 *
 * Provides Web Audio API–based score playback using SF2 SoundFont files
 * with section-pooled synths, spatial positioning, and convolution reverb.
 */

// Playback engine
export { PlaybackEngine } from "./PlaybackEngine";
export { Scheduler } from "./Scheduler";
export type {
  PlaybackState,
  PlayheadPosition,
  PlayheadResolver,
  PlaybackEventMap,
  PlaybackEngineOptions,
  ISampler,
  MidiTimeline,
  MidiEvent,
  TempoMapEntry,
  ScheduleCallback,
  SchedulerConfig,
  ClickEvent,
  ClickCallback,
} from "./types";
export { DEFAULT_ENGINE_OPTIONS } from "./types";

// Metronome
export { Metronome } from "./Metronome";
export type { MetronomeOptions, MetronomeBeat } from "./Metronome";

// SF2 SoundFont sampler (via spessasynth_lib)
export {
  Sf2Synth,
  Sf2SynthPool,
  Sf2Sampler,
  DRUM_KIT_STANDARD,
  DRUM_KIT_ORCHESTRA,
  type Sf2SamplerOptions,
} from "./Sf2Sampler";

// Layered sampler (e.g. solo + ensemble strings)
export { LayeredSampler } from "./LayeredSampler";
export type { LayerConfig } from "./LayeredSampler";
export { SamplerGroup } from "./SamplerGroup";

// GM program mapping
export {
  gmProgramForInstrument,
  gmProgramForPart,
  gmProgramName,
  isStringSoloProgram,
  unpitchedDrumForPartName,
  GM_STRING_ENSEMBLE_1,
  GM_STRING_ENSEMBLE_2,
  GM_TREMOLO_STRINGS,
} from "./gmPrograms";

// Spatial audio
export {
  SpatialNode,
  setListenerPosition,
  getOrchestraPosition,
  getOrchestraPositions,
  getInstrumentProjection,
  getInstrumentSection,
  ORCHESTRAL_POSITIONS,
  DEFAULT_LISTENER_POSITION,
} from "./SpatialNode";
export type { SpatialPosition, SpatialConfig, OrchestraSection } from "./SpatialNode";

// Reverb engine
export { ReverbEngine, REVERB_PRESETS } from "./ReverbEngine";
export type { ReverbPreset } from "./ReverbEngine";

// SoundFont capability manifests (what a font can play; drives percussion
// sound resolution + the editor's drum-kit mapping UI)
export {
  ACTIVE_SOUNDFONT_ID,
  getActiveCapabilities,
  getCapabilities,
  listDrumKits,
  getDrumKit,
  defaultDrumKitProgram,
  sampleAt,
  keyLabel,
  listSemantics,
  resolveSemantic,
} from "./soundfonts";
export type {
  Sf2Capabilities,
  SoundfontInfo,
  BankLayout,
  DrumKitCapability,
  DrumKeyCapability,
  MelodicPresetCapability,
  PercussionSemantic,
  SemanticResolution,
  KnownCollision,
} from "./soundfonts";

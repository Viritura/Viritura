export { createSoundProfileRegistry } from "./registry";
export type {
  MidiSoundSourceDefinition,
  OrchestraSection,
  PartRoutingDefaults,
  PlaybackCapabilities,
  ProfileResolveInput,
  ResolvedPartSound,
  SoundProfile,
  SoundProfileRegistry,
  SoundLayerDefaults,
  SoundLayeringDefaults,
  SoundResolutionKind,
  SourceCatalogEntry,
  SoundSourceDefinition,
  SoundSourceId,
  SoundSourceKind,
  SpatialPosition,
  VstSoundSourceDefinition,
} from "./types";
export {
  ORCHESTRA_SECTION_LABELS,
  ORCHESTRA_SECTION_ORDER,
  VIRITURA_SOUNDS_PROFILE_ID,
  VIRITURA_SOUNDS_SOURCE_OPTIONS,
  virituraSoundsProfile,
  virituraSoundsSourceId,
  type VirituraSoundsSourceOption,
} from "./virituraSounds";

import { createSoundProfileRegistry } from "./registry";
import { virituraSoundsProfile } from "./virituraSounds";
import type { SoundProfileRegistry } from "./types";

/** The profiles shipped with Viritura before user-installed profiles exist. */
export const defaultSoundProfileRegistry: SoundProfileRegistry = createSoundProfileRegistry([virituraSoundsProfile]);

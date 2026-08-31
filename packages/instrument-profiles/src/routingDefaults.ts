import type { OrchestraSection, PartRoutingDefaults } from "@viritura/sound-profiles";

/**
 * Per-section stage placement + projection distance for VST-routed parts. These
 * mirror VirituraSounds' section centroids so a VST profile inherits the same
 * concert-hall spatialization unless a future per-slot override changes it.
 */
const SECTION_ROUTING: Readonly<Record<OrchestraSection, Omit<PartRoutingDefaults, "section">>> = {
  strings: { stagePosition: { x: 0, y: 1.5 }, projectionRefDistance: 1 },
  woodwinds: { stagePosition: { x: 0, y: 6.5 }, projectionRefDistance: 3 },
  brass: { stagePosition: { x: 0, y: 8 }, projectionRefDistance: 6 },
  percussion: { stagePosition: { x: 0, y: 10.5 }, projectionRefDistance: 6 },
  keys: { stagePosition: { x: -4, y: 5 }, projectionRefDistance: 2 },
  voices: { stagePosition: { x: 0, y: 9 }, projectionRefDistance: 3 },
  other: { stagePosition: { x: 0, y: 0 }, projectionRefDistance: 1 },
};

/** Concert-hall listener position shared with the built-in profile. */
export const DEFAULT_LISTENER_POSITION = { x: 0, y: 1 } as const;

export function routingDefaultsFor(section: OrchestraSection): PartRoutingDefaults {
  const base = SECTION_ROUTING[section];
  return {
    section,
    stagePosition: { ...base.stagePosition },
    projectionRefDistance: base.projectionRefDistance,
  };
}

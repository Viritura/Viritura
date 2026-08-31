import type { OrchestraSection, PartRoutingDefaults, SpatialPosition } from "../types";

export const DEFAULT_LISTENER_POSITION: SpatialPosition = { x: 0, y: 1 };

export const FALLBACK_ROUTING: PartRoutingDefaults = {
  section: "other",
  stagePosition: { x: 0, y: 0 },
  projectionRefDistance: 1,
};

export function routing(
  section: OrchestraSection,
  x: number,
  y: number,
  projectionRefDistance: number,
): PartRoutingDefaults {
  return {
    section,
    stagePosition: { x, y },
    projectionRefDistance,
  };
}

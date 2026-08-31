import type { SoundSourceId } from "../types";

/** Stable VirituraSounds primary-source ID for one canonical instrument rule. */
export function virituraSoundsSourceId(instrumentId: string): SoundSourceId {
  return `${instrumentId}-primary`;
}

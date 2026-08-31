/**
 * SoundFont capability registry + accessors.
 *
 * Currently the app ships exactly one SoundFont (Shan SGM Pro 15), so the
 * "active" manifest is hard-coded here. The accessors are written against the
 * registry abstraction, so swapping in user-selectable SoundFonts later is a
 * matter of registering more manifests and changing `activeSoundfontId`.
 */

import rawManifest from "./shan-sgm-pro-15.capabilities.json";
import type { Sf2Capabilities, DrumKitCapability, PercussionSemantic, SemanticResolution } from "./types";

const shanSgmPro15 = rawManifest as unknown as Sf2Capabilities;

/** Registry of every SoundFont manifest the app knows about. */
const REGISTRY: Readonly<Record<string, Sf2Capabilities>> = {
  [shanSgmPro15.soundfont.id]: shanSgmPro15,
};

/** The SoundFont the app currently loads (see `PlaybackContext` boot fetch). */
export const ACTIVE_SOUNDFONT_ID = "shan-sgm-pro-15";

/** The capability manifest for the active SoundFont. */
export function getActiveCapabilities(): Sf2Capabilities {
  const caps = REGISTRY[ACTIVE_SOUNDFONT_ID];
  if (!caps) throw new Error(`No capability manifest registered for '${ACTIVE_SOUNDFONT_ID}'`);
  return caps;
}

/** Look up any registered manifest by SoundFont id. */
export function getCapabilities(soundfontId: string): Sf2Capabilities | undefined {
  return REGISTRY[soundfontId];
}

/** All drum kits in the active SoundFont, ordered by program number. */
export function listDrumKits(caps: Sf2Capabilities = getActiveCapabilities()): readonly DrumKitCapability[] {
  return caps.drumKits;
}

/** The drum kit with the given program, or undefined. */
export function getDrumKit(
  program: number,
  caps: Sf2Capabilities = getActiveCapabilities(),
): DrumKitCapability | undefined {
  return caps.drumKits.find((k) => k.program === program);
}

/** The program number of the default/Standard drum kit (lowest program). */
export function defaultDrumKitProgram(caps: Sf2Capabilities = getActiveCapabilities()): number {
  return caps.drumKits.reduce((min, k) => Math.min(min, k.program), Number.POSITIVE_INFINITY);
}

/** The sample that sounds when `key` is struck on the kit `program`, or null. */
export function sampleAt(program: number, key: number, caps: Sf2Capabilities = getActiveCapabilities()): string | null {
  return getDrumKit(program, caps)?.keys[String(key)]?.sample ?? null;
}

/** A label for a key on a kit: prefers the GM name, falls back to the sample. */
export function keyLabel(program: number, key: number, caps: Sf2Capabilities = getActiveCapabilities()): string {
  const entry = getDrumKit(program, caps)?.keys[String(key)];
  if (!entry) return `Key ${key}`;
  return entry.gm ?? entry.sample;
}

/** All semantic drum identities for the active SoundFont. */
export function listSemantics(
  caps: Sf2Capabilities = getActiveCapabilities(),
): ReadonlyArray<readonly [string, PercussionSemantic]> {
  return Object.entries(caps.percussionSemantics ?? {});
}

/**
 * Resolve a semantic drum identity to the concrete `(key, sample, borrowKit?)`
 * address for a given active kit program. Walks the identity's `fallback`
 * chain when the identity has no entry for that kit. Returns null if nothing
 * resolves (caller should fall back to the GM key on the active kit).
 */
export function resolveSemantic(
  semanticId: string,
  kitProgram: number,
  caps: Sf2Capabilities = getActiveCapabilities(),
): SemanticResolution | null {
  const semantics = caps.percussionSemantics;
  if (!semantics) return null;
  const seen = new Set<string>();
  let current: string | undefined = semanticId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const sem: PercussionSemantic | undefined = semantics[current];
    if (!sem) break;
    const direct = sem.resolution[String(kitProgram)];
    if (direct) return direct;
    // No entry for this kit — try the first fallback identity.
    current = sem.fallback?.[0];
  }
  return null;
}

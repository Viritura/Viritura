/**
 * Demo picture catalog.
 *
 * A composer evaluating video sync should not have to source a clip first, so
 * Viritura ships a curated entry that streams directly from a stable public
 * host. Three constraints drove the choice:
 *
 *  1. **Licensing.** The clip must be redistributable and re-scorable. Blender's
 *     open movies are released under Creative Commons Attribution, which permits
 *     exactly that provided the credit travels with it — hence `attribution`
 *     being a required field rather than a nicety.
 *  2. **Stable, CORS-enabled delivery.** Blender Studio's own asset links are
 *     time-signed S3 URLs that expire within the hour, so they cannot be
 *     embedded. Wikimedia Commons serves the same films from permanent URLs with
 *     `Access-Control-Allow-Origin: *` and byte-range support, which is what
 *     `<video>` needs to seek.
 *  3. **Suitability for sync.** Dialogue-free physical comedy with obvious
 *     impact moments makes a synchronization error immediately visible, which is
 *     the point of a demo.
 *
 * The catalog is data, not a hardcoded URL in the UI, so a self-hosted mirror
 * later becomes a one-line change.
 */

/** A picture that can be attached without the user supplying a file. */
export interface DemoVideoSource {
  id: string;
  /** Title shown in the picker. */
  title: string;
  /** One-line description of the clip. */
  description: string;
  /** Streamable media URL. Must be CORS-enabled and support range requests. */
  url: string;
  /** Approximate duration in seconds, for the picker. */
  durationSeconds: number;
  /** Approximate download size in bytes, so the user knows what they are starting. */
  approximateBytes: number;
  /** Required credit line, rendered wherever the clip is shown. */
  attribution: string;
  /** Human-readable licence name. */
  license: string;
  /** Canonical licence URL. */
  licenseUrl: string;
  /** Page describing the work, linked from the credit. */
  sourcePageUrl: string;
}

/**
 * Caminandes 3: Llamigos — Blender Foundation, CC BY.
 *
 * 2m30 of dialogue-free slapstick: a llama and a penguin fighting over a berry.
 * Plenty of hard physical hits to write to, and no dialogue to fight the score.
 */
export const CAMINANDES_LLAMIGOS: DemoVideoSource = {
  id: "caminandes-llamigos",
  title: "Caminandes 3: Llamigos",
  description: "Blender open movie — 2m30 of dialogue-free slapstick with plenty of picture markers.",
  url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm/Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm.480p.vp9.webm",
  // Measured, not rounded. A score that ships with this clip attached persists
  // the same number, and `settingsEqual` compares them: a mismatch here would
  // rewrite — and so dirty — every such score the moment it opened.
  durationSeconds: 150.12,
  approximateBytes: 16_655_692,
  attribution: "Caminandes 3: Llamigos © Blender Foundation — caminandes.com",
  license: "CC BY 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
  sourcePageUrl: "https://studio.blender.org/films/caminandes-3/",
};

/** Every demo picture Viritura offers. */
export const DEMO_VIDEO_SOURCES: readonly DemoVideoSource[] = [CAMINANDES_LLAMIGOS];

/** Look up a demo source by id. */
export function findDemoVideoSource(id: string): DemoVideoSource | undefined {
  return DEMO_VIDEO_SOURCES.find((source) => source.id === id);
}

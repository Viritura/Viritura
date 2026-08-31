/**
 * Shared types and helpers for radial menu modules.
 */

export type RadialMenuCategory =
  | "clef"
  | "barline"
  | "time-signature"
  | "key-signature"
  | "dynamic"
  | "ornament"
  | "tuplet"
  | "breath-fermata"
  | "fingering"
  | "repeat"
  | "articulation";

/** Conditionally include searchKeys only when the lookup hit. */
export function keys(map: Record<string, string[]>, id: string): { searchKeys: string[] } | Record<string, never> {
  const v = map[id];
  return v ? { searchKeys: v } : {};
}

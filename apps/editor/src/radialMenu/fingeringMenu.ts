/**
 * Fingering radial menu — digits 0-5.
 */

import type { RadialMenuItem } from "@viritura/ui";

export const FINGERING_ITEMS: RadialMenuItem[] = [
  { id: "0", label: "0", searchKeys: ["thumb", "zero"] },
  { id: "1", label: "1", searchKeys: ["index", "one"] },
  { id: "2", label: "2", searchKeys: ["middle", "two"] },
  { id: "3", label: "3", searchKeys: ["ring", "three"] },
  { id: "4", label: "4", searchKeys: ["pinky", "four", "little"] },
  { id: "5", label: "5", searchKeys: ["five"] },
];

export function resolveFingering(id: string): number | null {
  const n = parseInt(id, 10);
  return n >= 0 && n <= 5 ? n : null;
}

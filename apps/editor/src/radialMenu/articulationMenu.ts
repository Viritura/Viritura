/**
 * Articulation radial menu — all standard articulation types.
 * Accessible via Shift+A.
 */

import type { RadialMenuItem } from "@viritura/ui";
import type { ArticulationType } from "../commands/articulationCommands";

export const ARTICULATION_ITEMS: RadialMenuItem[] = [
  { id: "staccato", icon: "\uE4A2", label: "Staccato", searchKeys: ["dot"] },
  { id: "tenuto", icon: "\uE4A4", label: "Tenuto", searchKeys: ["held", "sustained"] },
  { id: "accent", icon: "\uE4A0", label: "Accent", searchKeys: ["emphasis"] },
  { id: "strongAccent", icon: "\uE4AC", label: "Marcato", searchKeys: ["strong accent", "hat"] },
  { id: "staccatissimo", icon: "\uE4A6", label: "Staccatissimo", searchKeys: ["wedge", "very short"] },
  {
    id: "staccatissimoWedge",
    icon: "\uE4A8",
    label: "Stacc. Wedge",
    searchKeys: ["staccatissimo wedge", "wedge variant"],
  },
  { id: "spiccato", icon: "\uE4AA", label: "Stacc. Stroke", searchKeys: ["staccatissimo stroke", "spiccato"] },
  { id: "stress", icon: "\uE4B6", label: "Stress", searchKeys: ["emphasis mark"] },
  { id: "unstress", icon: "\uE4B8", label: "Unstress", searchKeys: ["breve", "u"] },
];

/** Map radial menu item ID to ArticulationType. */
export function resolveArticulation(id: string): ArticulationType | null {
  const map: Record<string, ArticulationType> = {
    staccato: "staccato",
    tenuto: "tenuto",
    accent: "accent",
    strongAccent: "strongAccent",
    staccatissimo: "staccatissimo",
    staccatissimoWedge: "staccatissimoWedge",
    spiccato: "spiccato",
    stress: "stress",
    unstress: "unstress",
  };
  return map[id] ?? null;
}

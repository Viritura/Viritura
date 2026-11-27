import type { HarpPedalAlter, HarpPedalLetter, HarpPedalTuning } from "@viritura/core";

export const HARP_PEDAL_ORDER: readonly HarpPedalLetter[] = ["D", "C", "B", "E", "F", "G", "A"];
export const NATURAL_PEDALS: HarpPedalTuning = { D: 0, C: 0, B: 0, E: 0, F: 0, G: 0, A: 0 };

function alteration(character: string): HarpPedalAlter {
  if (character === "^") return -1;
  return character.toLowerCase() === "v" ? 1 : 0;
}

export function moveHarpPedal(current: HarpPedalAlter, direction: "up" | "down"): HarpPedalAlter {
  if (direction === "up") return current === 1 ? 0 : -1;
  return current === -1 ? 0 : 1;
}

export function formatHarpPedalAlter(alter: HarpPedalAlter): string {
  return alter === -1 ? "^" : alter === 1 ? "v" : "-";
}

/** Seven positions in diagram order; the divider and whitespace are optional. */
export function parseHarpPedalText(text: string): HarpPedalTuning | null {
  const value = text.replace(/\s/g, "");
  if (!/^[\^vV-]{3}\|?[\^vV-]{4}$/.test(value)) return null;
  const digits = value.replace("|", "");
  return {
    D: alteration(digits[0]!),
    C: alteration(digits[1]!),
    B: alteration(digits[2]!),
    E: alteration(digits[3]!),
    F: alteration(digits[4]!),
    G: alteration(digits[5]!),
    A: alteration(digits[6]!),
  };
}

export function formatHarpPedalText(tuning: HarpPedalTuning): string {
  const symbols = HARP_PEDAL_ORDER.map((letter) => formatHarpPedalAlter(tuning[letter]));
  return `${symbols.slice(0, 3).join("")}|${symbols.slice(3).join("")}`;
}

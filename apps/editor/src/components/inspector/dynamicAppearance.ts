import { glyphsForDynamicSpelling, type AuthoredDynamicValue } from "@viritura/core";

const SPELLINGS: readonly AuthoredDynamicValue[] = [
  "n",
  "pppppp",
  "ppppp",
  "pppp",
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
  "ffff",
  "fffff",
  "ffffff",
  "fp",
  "pf",
  "sf",
  "sfp",
  "sfpp",
  "sfz",
  "sffz",
  "fz",
  "rf",
  "rfz",
];

export const DYNAMIC_SYMBOL_OPTIONS = [
  ...SPELLINGS.flatMap((spelling) => {
    const glyphs = glyphsForDynamicSpelling(spelling);
    const glyph = glyphs?.[0];
    return glyphs?.length === 1 && glyph !== undefined
      ? [{ value: glyph, label: spelling === "n" ? "niente" : spelling }]
      : [];
  }),
  { value: "dynamicMezzo", label: "m" },
  { value: "dynamicSforzando", label: "s" },
  { value: "dynamicRinforzando", label: "r" },
  { value: "dynamicZ", label: "z" },
  { value: "dynamicSforzatoPiano", label: "sfzp" },
];

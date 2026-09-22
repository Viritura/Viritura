import type { Part } from "@viritura/core";

export type PartChordSymbolUpdate = Pick<Part, "chordSymbolVisibility">;

export const CHORD_SYMBOL_VISIBILITY_OPTIONS = [
  { value: "auto", label: "Automatic" },
  { value: "show", label: "Show" },
  { value: "hide", label: "Hide" },
] as const satisfies readonly { value: NonNullable<Part["chordSymbolVisibility"]>; label: string }[];

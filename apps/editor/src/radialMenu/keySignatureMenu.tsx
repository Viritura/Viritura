/**
 * Key signature radial menu — items and resolver.
 */

import type { RadialMenuItem } from "@viritura/ui";
import type { KeySignature } from "@viritura/core";
import { KEY_SIG_PALETTE_ITEMS } from "../components/palette/paletteItems";
import { KeySigGlyph } from "../components/palette/GlyphRenderers";
import { keys } from "./types";

// Custom ordering — sharps on right (clockwise from top), flats on left:
//   Page 1: C maj → 1♯ 2♯ 3♯ 4♯ (right) → 4♭ 3♭ 2♭ 1♭ (left)
//   Page 2: Atonal → 5♯ 6♯ 7♯ (right) → 7♭ 6♭ 5♭ (left)
const KEY_SIG_ORDER = ["0", "1", "2", "3", "4", "-4", "-3", "-2", "-1", "atonal", "5", "6", "7", "-7", "-6", "-5"];

// Search aliases — case-sensitive: uppercase = major key, lowercase = minor key.
// Whitespace is stripped before matching, so "7 sharp" matches "7sharp".
// Single-letter: case-sensitive (D = D major, d = d minor).
// With explicit "major"/"minor": case-insensitive on the letter (d major = D major).
const KEY_SIG_SEARCH_KEYS: Record<string, string[]> = {
  "0": ["C", "a", "Cmaj", "amin", "Cmajor", "cmajor", "aminor", "Aminor"],
  "1": ["G", "e", "Gmaj", "emin", "Gmajor", "gmajor", "eminor", "Eminor", "1#", "1s", "1sharp"],
  "2": ["D", "b", "Dmaj", "bmin", "Dmajor", "dmajor", "bminor", "Bminor", "2#", "2s", "2sharp"],
  "3": ["A", "f#", "Amaj", "f#min", "Amajor", "amajor", "f#minor", "F#minor", "fsharp", "3#", "3s", "3sharp"],
  "4": ["E", "c#", "Emaj", "c#min", "Emajor", "emajor", "c#minor", "C#minor", "csharp", "4#", "4s", "4sharp"],
  "5": ["B", "g#", "Bmaj", "g#min", "Bmajor", "bmajor", "g#minor", "G#minor", "gsharp", "5#", "5s", "5sharp"],
  "6": [
    "F#",
    "d#",
    "F#maj",
    "d#min",
    "F#major",
    "f#major",
    "d#minor",
    "D#minor",
    "Fsharp",
    "dsharp",
    "6#",
    "6s",
    "6sharp",
  ],
  "7": [
    "C#",
    "a#",
    "C#maj",
    "a#min",
    "C#major",
    "c#major",
    "a#minor",
    "A#minor",
    "Csharp",
    "asharp",
    "7#",
    "7s",
    "7sharp",
  ],
  "-1": ["F", "d", "Fmaj", "dmin", "Fmajor", "fmajor", "dminor", "Dminor", "1b", "1flat"],
  "-2": ["Bb", "g", "Bbmaj", "gmin", "Bbmajor", "bbmajor", "gminor", "Gminor", "Bflat", "2b", "2flat"],
  "-3": ["Eb", "c", "Ebmaj", "cmin", "Ebmajor", "ebmajor", "cminor", "Cminor", "Eflat", "3b", "3flat"],
  "-4": ["Ab", "f", "Abmaj", "fmin", "Abmajor", "abmajor", "fminor", "Fminor", "Aflat", "4b", "4flat"],
  "-5": ["Db", "bb", "Dbmaj", "bbmin", "Dbmajor", "dbmajor", "bbminor", "Bbminor", "Dflat", "bflat", "5b", "5flat"],
  "-6": ["Gb", "eb", "Gbmaj", "ebmin", "Gbmajor", "gbmajor", "ebminor", "Ebminor", "Gflat", "eflat", "6b", "6flat"],
  "-7": ["Cb", "ab", "Cbmaj", "abmin", "Cbmajor", "cbmajor", "abminor", "Abminor", "Cflat", "aflat", "7b", "7flat"],
  atonal: ["atonal", "open", "keyless", "none", "x"],
};

export const KEY_SIGNATURE_ITEMS: RadialMenuItem[] = KEY_SIG_ORDER.map((id) => {
  const p = KEY_SIG_PALETTE_ITEMS.find((k) => k.id === id)!;
  return {
    id: p.id,
    icon: p.keySig.atonal ? "×" : <KeySigGlyph fifths={p.keySig.fifths} />,
    label: p.shortLabel,
    caseSensitiveSearch: true,
    ...keys(KEY_SIG_SEARCH_KEYS, id),
  };
});

export function resolveKeySignature(id: string): KeySignature | null {
  const item = KEY_SIG_PALETTE_ITEMS.find((p) => p.id === id);
  if (!item) return null;
  return { fifths: item.keySig.fifths, ...(item.keySig.atonal ? { atonal: true } : {}) };
}

/**
 * Articulation element-id names.
 *
 * The engine tags each articulation glyph with the `markings` field it draws
 * (`{event}/art-accent`), rather than a positional index. Position is not
 * stable: a glyph's placement pass depends on slur participation, so adding a
 * slur can renumber an event's articulations, and an id that changes meaning
 * under an unrelated edit cannot carry a selection or address a delete.
 *
 * Combos are one ligature glyph standing for two markings, and are named for
 * both, joined by `.` — `art-accent.staccato`. There is no way to click "just
 * the staccato dot" of a ligature, so selecting one selects both, and deleting
 * one deletes both.
 *
 * This mirrors `collect_articulation_glyphs` in the engine. The two must agree:
 * a name produced here that the engine never emits is an id that selects
 * nothing.
 */

import type { Markings } from "@viritura/core";

/** Marking fields that can appear in an articulation name. */
export type ArticulationMarking =
  | "staccato"
  | "staccatissimo"
  | "staccatissimoWedge"
  | "spiccato"
  | "accent"
  | "tenuto"
  | "strongAccent"
  | "softAccent"
  | "stress"
  | "unstress"
  | "bowDirection";

/**
 * The marking fields an articulation name refers to. A combo name yields both
 * constituents; an unrecognised name yields none.
 */
export function markingsForArticulationName(name: string): ArticulationMarking[] {
  const parts = name.split(".");
  const known = parts.filter((p): p is ArticulationMarking => ARTICULATION_MARKINGS.has(p as ArticulationMarking));
  return known.length === parts.length ? known : [];
}

const ARTICULATION_MARKINGS: ReadonlySet<ArticulationMarking> = new Set([
  "staccato",
  "staccatissimo",
  "staccatissimoWedge",
  "spiccato",
  "accent",
  "tenuto",
  "strongAccent",
  "softAccent",
  "stress",
  "unstress",
  "bowDirection",
]);

/**
 * Articulation names an event's markings produce, in the engine's collection
 * order. Used to enumerate an event's articulations for navigation.
 */
export function articulationNamesInMarkings(markings: Markings | undefined): string[] {
  if (!markings) return [];
  const names: string[] = [];

  const combo = comboName(markings);
  if (combo) {
    names.push(combo);
  } else {
    if (markings.staccato) names.push("staccato");
    if (markings.tenuto) names.push("tenuto");
    if (markings.accent) names.push("accent");
    if (markings.strongAccent) names.push("strongAccent");
  }

  // Never part of a combo — always their own glyph.
  if (markings.staccatissimo) names.push("staccatissimo");
  if (markings.staccatissimoWedge) names.push("staccatissimoWedge");
  if (markings.spiccato) names.push("spiccato");
  if (markings.softAccent && combo !== "tenuto.accent") names.push("softAccent");
  if (markings.stress) names.push("stress");
  if (markings.unstress) names.push("unstress");
  if (markings.bowDirection) names.push("bowDirection");

  return names;
}

/**
 * The ligature name for this event, when exactly two of staccato / tenuto /
 * accent / strongAccent are present and they form a known pair.
 */
function comboName(markings: Markings): string | null {
  const staccato = markings.staccato !== undefined;
  const tenuto = markings.tenuto !== undefined;
  const accent = markings.accent !== undefined;
  const marcato = markings.strongAccent !== undefined;

  if (marcato && staccato && !tenuto && !accent) return "strongAccent.staccato";
  if (marcato && tenuto && !staccato && !accent) return "strongAccent.tenuto";
  if (accent && staccato && !marcato && !tenuto) return "accent.staccato";
  if (tenuto && staccato && !accent && !marcato) return "tenuto.staccato";
  if (tenuto && accent && !staccato && !marcato) return "tenuto.accent";
  return null;
}

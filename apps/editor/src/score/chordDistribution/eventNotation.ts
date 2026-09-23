/**
 * Event-level notation that survives chord redistribution.
 *
 * Distribution rewrites the rhythm, so destination events are minted fresh and
 * nothing on the source event carries over unless it is listed here.
 *
 * Standard engraving practice for an exploded divisi is that every resulting
 * line keeps the expression of the chord it came from: a staccato chord becomes
 * staccato notes on every staff, a fermata stops the whole ensemble, and each
 * exploded vocal line keeps its syllable. Reduce is the mirror image — the
 * chord absorbs the expression of every line feeding it.
 *
 * Deliberately excluded:
 *  - `stemDirection`, `orient` and `staff` are layout overrides chosen for the
 *    source's voicing. A stem forced down to clear a second voice is wrong once
 *    the note is alone on its own staff.
 *  - `slurs` and `glissandos` address a partner event by id, and distribution
 *    mints new ids, so carrying them would leave dangling targets.
 */

import type { Fermata, Lyrics, LyricLine, Markings, NoteEvent } from "@viritura/core";

/** The subset of a source event's notation that redistribution reproduces. */
export interface CarriedNotation {
  markings?: Markings;
  fermata?: Fermata;
  lyrics?: Lyrics;
}

function mergedLyrics(into: Lyrics | undefined, from: Lyrics): Lyrics {
  const lines: Record<string, LyricLine> = { ...(from.lines ?? {}) };
  for (const [key, line] of Object.entries(into?.lines ?? {})) lines[key] = line;
  return { lines };
}

/**
 * Collapse the notation of every source event contributing to one destination
 * event. Earlier events win each field, which for reduce means the topmost
 * staff decides where the sources disagree.
 */
export function carriedNotation(events: readonly NoteEvent[]): CarriedNotation | undefined {
  let carried: CarriedNotation | undefined;
  for (const event of events) {
    if (event.markings) carried = { ...carried, markings: { ...event.markings, ...(carried?.markings ?? {}) } };
    if (event.fermata && !carried?.fermata) carried = { ...carried, fermata: event.fermata };
    if (event.lyrics) carried = { ...carried, lyrics: mergedLyrics(carried?.lyrics, event.lyrics) };
  }
  return carried ? structuredClone(carried) : undefined;
}

/** Stamp carried notation onto a freshly minted destination event. */
export function applyCarriedNotation(event: NoteEvent, carried: CarriedNotation | undefined): void {
  if (!carried) return;
  if (carried.markings) event.markings = structuredClone(carried.markings);
  if (carried.fermata) event.fermata = structuredClone(carried.fermata);
  if (carried.lyrics) event.lyrics = structuredClone(carried.lyrics);
}
